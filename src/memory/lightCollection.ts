// ---------------------------------------------------------------------------
// Phase 6e: Light Collection — FIFO/LRU eviction, no reactive scoring
// ---------------------------------------------------------------------------
// A lightweight variant of `collection` that replaces `reactiveScored`
// (O(log n) heap with per-node subscriptions) with simple FIFO or LRU
// eviction (O(1), no subscriptions). Same `Collection<T>` interface.
//
// Use when eviction quality < raw speed — message buffers, caches,
// high-throughput ingestion paths.
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { batch, teardown } from "../core/protocol";
import { state } from "../core/state";
import { subscribe } from "../core/subscribe";
import type { Store } from "../core/types";
import { reactiveIndex } from "../data/reactiveIndex";
import type { EvictionPolicy } from "../utils/eviction";
import { fifo, lru } from "../utils/eviction";
import { computeScore } from "./decay";
import { memoryNode } from "./node";
import type {
	AdmissionDecision,
	Collection as CollectionInterface,
	LightCollectionOptions,
	MemoryNode as MemoryNodeInterface,
	MemoryNodeOptions,
	ScoreWeights,
} from "./types";

let lightCollectionCounter = 0;

/**
 * Creates a lightweight reactive collection that uses FIFO or LRU eviction
 * instead of decay-scored reactive eviction. Same `Collection<T>` interface
 * as `collection()` — drop-in replacement for high-throughput paths.
 *
 * @param opts - Optional configuration.
 *
 * @returns `Collection<T>` — identical interface to `collection()`.
 *
 * @optionsType LightCollectionOptions
 * @option maxSize | number | Infinity | Maximum nodes. Evicted by FIFO or LRU on overflow.
 * @option eviction | "fifo" \| "lru" | "fifo" | Eviction strategy.
 * @option weights | ScoreWeights | {} | Default weights for topK scoring (eviction does NOT use scores).
 * @option admissionPolicy | AdmissionPolicyFn<T> | undefined | Gate every add().
 * @option forgetPolicy | ForgetPolicyFn<T> | undefined | Predicate run before each add() and during gc().
 *
 * @remarks **FIFO** evicts the oldest-inserted node regardless of access. **LRU** evicts the least-recently-accessed node — `get()` counts as an access.
 * @remarks **No per-node subscriptions.** Unlike `collection()` which subscribes to every node's `.meta` for reactive score updates, `lightCollection` has zero per-node overhead beyond tag tracking.
 *
 * @example
 * ```ts
 * import { lightCollection } from 'callbag-recharge/memory';
 *
 * // FIFO buffer — oldest out
 * const buf = lightCollection<string>({ maxSize: 1000 });
 *
 * // LRU cache — least-recently-used out
 * const cache = lightCollection<string>({ maxSize: 100, eviction: "lru" });
 * ```
 *
 * @seeAlso [collection](./collection) — decay-scored eviction, [memoryNode](./memoryNode) — individual memory node
 */
export function lightCollection<T>(opts?: LightCollectionOptions<T>): CollectionInterface<T> {
	const id = ++lightCollectionCounter;
	const maxSize = opts?.maxSize ?? Infinity;
	const evictionType = opts?.eviction ?? "fifo";
	const defaultWeights = opts?.weights ?? {};
	const admissionPolicy = opts?.admissionPolicy;
	const forgetPolicy = opts?.forgetPolicy;

	// Internal storage
	const _nodes = new Map<string, MemoryNodeInterface<T>>();

	// Tag index — O(1) tag-based lookups via reactiveIndex
	const _tagIndex = reactiveIndex();
	const _tagEffects = new Map<string, () => void>();

	// Simple eviction — no per-node subscriptions, no reactive scoring
	const _evictionPolicy: EvictionPolicy<string> | null =
		maxSize < Infinity ? (evictionType === "lru" ? lru<string>() : fifo<string>()) : null;

	// Version-gated reactive stores
	const _version = state<number>(0, { name: `lightCollection-${id}:ver` });
	const _nodesStore = derived([_version], () => Array.from(_nodes.values()), {
		name: `lightCollection-${id}:nodes`,
	}) as Store<MemoryNodeInterface<T>[]>;
	const _sizeStore = derived([_version], () => _nodes.size, {
		name: `lightCollection-${id}:size`,
	});

	let destroyed = false;

	function _bumpVersion(): void {
		_version.update((v) => v + 1);
	}

	function _trackTags(node: MemoryNodeInterface<T>): void {
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
						// LRU: touch on update — counts as access
						_evictionPolicy?.touch(target.id);
						return target;
					}

					case "merge": {
						const target = _nodes.get(decision.targetId);
						if (!target) throw new Error(`Admission merge target "${decision.targetId}" not found`);
						const merged = decision.reducer(target.content.get(), content);
						target.update(merged);
						// LRU: touch on merge — counts as access
						_evictionPolicy?.touch(target.id);
						return target;
					}

					default:
						break; // fall through to normal add
				}
			}

			// Run forget pass before insertion
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
			const node = _nodes.get(nodeId);
			// LRU: touch on read — counts as access. FIFO touch is a no-op.
			if (node) _evictionPolicy?.touch(nodeId);
			return node;
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
			const uniqueIds = Array.from(new Set(nodeIds));
			const sourceNodes: MemoryNodeInterface<T>[] = [];
			for (const nid of uniqueIds) {
				const node = _nodes.get(nid);
				if (node) sourceNodes.push(node);
			}
			if (sourceNodes.length === 0) throw new Error("No valid nodes to summarize");

			const summarized = reducer(sourceNodes);

			let newNode!: MemoryNodeInterface<T>;
			batch(() => {
				for (const node of sourceNodes) {
					_untrackTags(node.id);
					_evictionPolicy?.delete(node.id);
					node.destroy();
					_nodes.delete(node.id);
				}
				if (forgetPolicy) _runForgetPolicy();
				newNode = memoryNode<T>(summarized, nodeOpts);
				_nodes.set(newNode.id, newNode);
				_trackTags(newNode);
				_evictionPolicy?.insert(newNode.id);
				_evictIfNeeded();
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
			for (const dispose of _tagEffects.values()) dispose();
			_tagEffects.clear();
			_tagIndex.destroy();
			batch(() => {
				for (const node of _nodes.values()) node.destroy();
				_nodes.clear();
			});
			teardown(_version);
		},
	};

	return col;
}
