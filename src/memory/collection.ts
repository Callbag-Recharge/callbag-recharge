// ---------------------------------------------------------------------------
// Phase 1: Collection — reactive set of MemoryNodes
// ---------------------------------------------------------------------------
// A collection manages a set of MemoryNodes with reactive tracking.
// Supports query, tag-based lookup, top-K scoring, and auto-eviction.
//
// Design:
// - _nodes: Map<string, MemoryNode<T>> for O(1) ID lookup
// - _nodesStore: state<MemoryNode<T>[]> for reactive node list
// - _sizeStore: derived from _nodesStore for reactive count
// - _tagIndex: reactiveIndex for O(1) tag-based lookups (replaces O(n) scan)
// - maxSize eviction uses decay scoring — lowest-score nodes evicted first
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { batch, teardown } from "../core/protocol";
import { state } from "../core/state";
import { subscribe } from "../core/subscribe";
import type { Store } from "../core/types";
import { reactiveIndex } from "../data/reactiveIndex";
import { reactiveScored } from "../utils/reactiveEviction";
import { computeScore } from "./decay";
import { memoryNode } from "./node";
import type {
	AdmissionDecision,
	Collection as CollectionInterface,
	CollectionOptions,
	MemoryNode as MemoryNodeInterface,
	MemoryNodeOptions,
	ScoreWeights,
} from "./types";

let collectionCounter = 0;

/**
 * Creates a reactive collection of `MemoryNode<T>` values with tag indexing,
 * decay-scored eviction, and memory lifecycle management.
 *
 * @param opts - Optional configuration.
 *
 * @returns `Collection<T>` with the following API:
 *
 * @returnsTable add(content, opts?) | (content: T, opts?: MemoryNodeOptions) => MemoryNode<T> \| undefined | Add a node. Returns undefined if admissionPolicy rejects.
 * remove(nodeOrId) | (nodeOrId: MemoryNode<T> \| string) => boolean | Remove a node by reference or ID.
 * get(id) | (id: string) => MemoryNode<T> \| undefined | Get a node by ID.
 * has(id) | (id: string) => boolean | Check if a node exists.
 * nodes | Store<MemoryNode<T>[]> | Reactive store of all nodes (updates on add/remove/summarize).
 * size | Store<number> | Reactive node count.
 * query(filter) | (filter: (n: MemoryNode<T>) => boolean) => MemoryNode<T>[] | Snapshot filter.
 * byTag(tag) | (tag: string) => MemoryNode<T>[] | O(1) tag lookup via reactiveIndex.
 * topK(k, weights?) | (k: number, weights?: ScoreWeights) => MemoryNode<T>[] | Top-k by decay score.
 * summarize(ids, reducer, opts?) | (...) => MemoryNode<T> | Consolidate nodes into one.
 * gc() | () => number | Run forgetPolicy on demand; returns count removed.
 * tagIndex | ReactiveIndex | Reactive tag-to-nodeId index.
 * destroy() | () => void | Tear down all nodes and internal stores.
 *
 * @optionsType CollectionOptions
 * @option maxSize | number | Infinity | Maximum nodes. Lowest-scored evicted on overflow.
 * @option weights | ScoreWeights | {} | Default weights for topK and eviction scoring.
 * @option admissionPolicy | AdmissionPolicyFn<T> | undefined | Gate every add(): admit, reject, update an existing node, or merge into one.
 * @option forgetPolicy | ForgetPolicyFn<T> | undefined | Predicate run before each add() and during gc(). Return true to remove a node.
 *
 * @remarks **Admission policy:** Called synchronously on every `add()` with a snapshot of current nodes. Returns `{ action: "admit" | "reject" | "update" | "merge" }`. Use for dedup, conflict resolution, and content merging.
 * @remarks **Forget policy:** Runs on existing nodes before each new admission and on explicit `gc()` calls. The newly-admitted node is never evaluated by the policy in the same call.
 * @remarks **Summarize:** Removes source nodes and inserts one consolidated node in a single `batch()` — subscribers see one atomic update. Run forgetPolicy on survivors before inserting the new node.
 * @remarks **Eviction vs forget:** `maxSize` eviction uses decay scoring (score-based heap). `forgetPolicy` is content/quality-based. Both can coexist — forget runs first, then eviction trims any remaining overflow.
 * @remarks **Reactivity:** `nodes` and `size` are derived from an internal version counter that bumps on structural changes (add/remove/summarize/gc). Node content changes are reactive through each node's own stores, not through the collection stores.
 *
 * @example
 * ```ts
 * import { collection } from 'callbag-recharge/memory';
 *
 * const mem = collection<string>({ maxSize: 100 });
 *
 * const n = mem.add("The sky is blue", { importance: 0.8, tags: ["fact"] });
 * n!.touch(); // update accessedAt + accessCount
 * mem.topK(5); // top 5 by decay score
 * ```
 *
 * @example Dedup with admissionPolicy
 * ```ts
 * const mem = collection<string>({
 *   admissionPolicy: (incoming, nodes) => {
 *     const dup = nodes.find(n => n.content.get() === incoming);
 *     if (dup) return { action: "update", targetId: dup.id, content: incoming };
 *     return { action: "admit" };
 *   },
 * });
 * ```
 *
 * @example Auto-prune stale nodes with forgetPolicy
 * ```ts
 * const mem = collection<string>({
 *   forgetPolicy: (node) => node.meta.get().importance < 0.1,
 * });
 * // Stale nodes pruned before each add(); call mem.gc() for on-demand cleanup.
 * ```
 *
 * @seeAlso [memoryNode](./node) — individual memory node, [decay](./decay) — scoring functions, [vectorIndex](./vectorIndex) — HNSW semantic search
 */
export function collection<T>(opts?: CollectionOptions<T>): CollectionInterface<T> {
	const id = ++collectionCounter;
	const maxSize = opts?.maxSize ?? Infinity;
	const defaultWeights = opts?.weights ?? {};
	const admissionPolicy = opts?.admissionPolicy;
	const forgetPolicy = opts?.forgetPolicy;

	// Internal storage
	const _nodes = new Map<string, MemoryNodeInterface<T>>();

	// Tag index — O(1) tag-based lookups via reactiveIndex
	const _tagIndex = reactiveIndex();
	// Per-node effect disposers for tag change tracking
	const _tagEffects = new Map<string, () => void>();

	// Reactive eviction policy — O(log n) heap, updated on every meta push.
	// Subscribes directly to node.meta via effect — no intermediate derived needed.
	// computeScore runs inline in the effect handler with collection's weights
	// (node.scoreStore uses node-level empty weights — not the same thing).
	const _evictionPolicy =
		maxSize < Infinity
			? reactiveScored(
					(nodeId: string) => _nodes.get(nodeId)!.meta,
					(meta) => computeScore(meta, defaultWeights),
				)
			: null;

	// Version-gated reactive stores — bump version on structural change,
	// derived stores materialize lazily from the version (like reactiveMap).
	// Avoids Array.from() allocation on every add/remove.
	const _version = state<number>(0, { name: `collection-${id}:ver` });
	const _nodesStore = derived([_version], () => Array.from(_nodes.values()), {
		name: `collection-${id}:nodes`,
	}) as Store<MemoryNodeInterface<T>[]>;
	const _sizeStore = derived([_version], () => _nodes.size, {
		name: `collection-${id}:size`,
	});

	let destroyed = false;

	function _bumpVersion(): void {
		_version.update((v) => v + 1);
	}

	function _trackTags(node: MemoryNodeInterface<T>): void {
		// Subscribe to node.meta — fires when this node's tags change.
		// Uses subscribe (callbag sink) instead of effect — lighter weight,
		// no DIRTY/RESOLVED overhead, no cleanup return handling.
		// Initial tag index update is done inline after subscribe.
		const currentTags = Array.from(node.meta.get().tags);
		_tagIndex.update(node.id, currentTags);
		const sub = subscribe(node.meta, (meta) => {
			const tags = Array.from(meta.tags);
			_tagIndex.update(node.id, tags);
		});
		_tagEffects.set(node.id, () => sub.unsubscribe());
	}

	function _untrackTags(nodeId: string): void {
		const dispose = _tagEffects.get(nodeId);
		if (dispose) {
			dispose();
			_tagEffects.delete(nodeId);
		}
		_tagIndex.remove(nodeId);
	}

	function _evictIfNeeded(): void {
		if (!_evictionPolicy || _nodes.size <= maxSize) return;
		const toRemove = _evictionPolicy.evict(_nodes.size - maxSize);
		for (const nodeId of toRemove) {
			const node = _nodes.get(nodeId);
			if (node) {
				_untrackTags(nodeId);
				node.destroy();
				_nodes.delete(nodeId);
			}
		}
	}

	function _runForgetPolicy(): number {
		if (!forgetPolicy) return 0;
		const toRemove: string[] = [];
		for (const node of _nodes.values()) {
			if (forgetPolicy(node)) toRemove.push(node.id);
		}
		for (const nodeId of toRemove) {
			const node = _nodes.get(nodeId);
			if (node) {
				_untrackTags(nodeId);
				_evictionPolicy?.delete(nodeId);
				node.destroy();
				_nodes.delete(nodeId);
			}
		}
		return toRemove.length;
	}

	const col: CollectionInterface<T> = {
		add(content: T, nodeOpts?: MemoryNodeOptions): MemoryNodeInterface<T> | undefined {
			if (destroyed) throw new Error("Collection is destroyed");

			// Admission policy gate
			if (admissionPolicy) {
				const snapshot = Array.from(_nodes.values());
				const decision: AdmissionDecision<T> = admissionPolicy(content, snapshot);

				switch (decision.action) {
					case "reject":
						return undefined;

					case "update": {
						const target = _nodes.get(decision.targetId);
						if (!target)
							throw new Error(`Admission update target "${decision.targetId}" not found`);
						target.update(decision.content);
						// update/merge don't change collection structure — no version bump needed.
						// Node content reactivity flows through the node's own content/meta stores.
						// Use gc() for explicit forget-policy cleanup.
						return target;
					}

					case "merge": {
						const target = _nodes.get(decision.targetId);
						if (!target) throw new Error(`Admission merge target "${decision.targetId}" not found`);
						const merged = decision.reducer(target.content.get(), content);
						target.update(merged);
						return target;
					}

					default:
						break; // fall through to normal add (including "admit")
				}
			}

			// Run forget pass before insertion — cleans up stale existing nodes
			// without risking immediately forgetting the node we're about to admit.
			if (forgetPolicy) _runForgetPolicy();

			const node = memoryNode<T>(content, nodeOpts);
			_nodes.set(node.id, node);
			_trackTags(node);
			_evictionPolicy?.insert(node.id);
			_evictIfNeeded();
			_bumpVersion();
			return node;
		},

		remove(nodeOrId: MemoryNodeInterface<T> | string): boolean {
			const nodeId = typeof nodeOrId === "string" ? nodeOrId : nodeOrId.id;
			const node = _nodes.get(nodeId);
			if (!node) return false;
			_untrackTags(nodeId);
			_evictionPolicy?.delete(nodeId);
			node.destroy();
			_nodes.delete(nodeId);
			_bumpVersion();
			return true;
		},

		get(nodeId: string): MemoryNodeInterface<T> | undefined {
			return _nodes.get(nodeId);
		},

		has(nodeId: string): boolean {
			return _nodes.has(nodeId);
		},

		nodes: _nodesStore as Store<MemoryNodeInterface<T>[]>,
		size: _sizeStore,
		tagIndex: _tagIndex,

		query(filter: (node: MemoryNodeInterface<T>) => boolean): MemoryNodeInterface<T>[] {
			const result: MemoryNodeInterface<T>[] = [];
			for (const node of _nodes.values()) {
				if (filter(node)) result.push(node);
			}
			return result;
		},

		byTag(tag: string): MemoryNodeInterface<T>[] {
			const nodeIds = _tagIndex.get(tag);
			const result: MemoryNodeInterface<T>[] = [];
			for (const nodeId of nodeIds) {
				const node = _nodes.get(nodeId);
				if (node) result.push(node);
			}
			return result;
		},

		topK(k: number, weights?: ScoreWeights): MemoryNodeInterface<T>[] {
			const w = weights ?? defaultWeights;
			const now = Date.now();
			const scored = Array.from(_nodes.values()).map((n) => ({
				node: n,
				score: computeScore(n.meta.get(), w, now),
			}));
			scored.sort((a, b) => b.score - a.score);
			return scored.slice(0, k).map((s) => s.node);
		},

		summarize(
			nodeIds: string[],
			reducer: (nodes: MemoryNodeInterface<T>[]) => T,
			nodeOpts?: MemoryNodeOptions,
		): MemoryNodeInterface<T> {
			if (destroyed) throw new Error("Collection is destroyed");
			// Deduplicate to prevent double-destroy on repeated IDs
			const uniqueIds = Array.from(new Set(nodeIds));
			const sourceNodes: MemoryNodeInterface<T>[] = [];
			for (const nid of uniqueIds) {
				const node = _nodes.get(nid);
				if (node) sourceNodes.push(node);
			}
			if (sourceNodes.length === 0) throw new Error("No valid nodes to summarize");

			// Run reducer before any teardown — if it throws, source nodes remain intact
			const summarized = reducer(sourceNodes);

			// Wrap entire mutation in one batch — single atomic reactive update wave
			let newNode!: MemoryNodeInterface<T>;
			batch(() => {
				for (const node of sourceNodes) {
					_untrackTags(node.id);
					_evictionPolicy?.delete(node.id);
					node.destroy();
					_nodes.delete(node.id);
				}
				// Run forget pass on survivors after source removal, before inserting
				// the consolidated node — keeps the new node safe from being immediately
				// forgotten by the policy.
				if (forgetPolicy) _runForgetPolicy();
				newNode = memoryNode<T>(summarized, nodeOpts);
				_nodes.set(newNode.id, newNode);
				_trackTags(newNode);
				_evictionPolicy?.insert(newNode.id);
				_bumpVersion();
			});
			return newNode;
		},

		gc(): number {
			if (destroyed) throw new Error("Collection is destroyed");
			const removed = _runForgetPolicy();
			if (removed > 0) _bumpVersion();
			return removed;
		},

		destroy(): void {
			if (destroyed) return;
			destroyed = true;
			_evictionPolicy?.clear();
			// Dispose tag-tracking effects — local cleanup alongside node teardown.
			for (const dispose of _tagEffects.values()) dispose();
			_tagEffects.clear();
			_tagIndex.destroy();
			// Clear nodes first so END subscribers observe an empty collection.
			// teardown(_version) cascades END to _nodesStore, _sizeStore,
			// and any external subscribers — they must see _nodes already empty.
			batch(() => {
				for (const node of _nodes.values()) node.destroy();
				_nodes.clear();
			});
			teardown(_version);
		},
	};

	return col;
}
