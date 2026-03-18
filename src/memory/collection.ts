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
import { effect } from "../core/effect";
import { batch, teardown } from "../core/protocol";
import { state } from "../core/state";
import type { Store } from "../core/types";
import { reactiveIndex } from "../data/reactiveIndex";
import { reactiveScored } from "../utils/reactiveEviction";
import { computeScore } from "./decay";
import { memoryNode } from "./node";
import type {
	Collection as CollectionInterface,
	CollectionOptions,
	MemoryNode as MemoryNodeInterface,
	MemoryNodeOptions,
	ScoreWeights,
} from "./types";

let collectionCounter = 0;

export function collection<T>(opts?: CollectionOptions): CollectionInterface<T> {
	const id = ++collectionCounter;
	const maxSize = opts?.maxSize ?? Infinity;
	const defaultWeights = opts?.weights ?? {};

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

	// Reactive stores
	const _nodesStore = state<MemoryNodeInterface<T>[]>([], {
		name: `collection-${id}:nodes`,
		equals: () => false, // Always emit on mutation (array identity changes)
	});
	const _sizeStore = derived([_nodesStore], () => _nodesStore.get().length, {
		name: `collection-${id}:size`,
	});

	let destroyed = false;

	function _syncNodesStore(): void {
		_nodesStore.set(Array.from(_nodes.values()));
	}

	function _trackTags(node: MemoryNodeInterface<T>): void {
		// Effect runs eagerly on creation — handles both initial and subsequent tag changes.
		// No separate _tagIndex.add() needed; update() does add on first call.
		const dispose = effect([node.meta], () => {
			const currentTags = Array.from(node.meta.get().tags);
			_tagIndex.update(node.id, currentTags);
			return undefined;
		});
		_tagEffects.set(node.id, dispose);
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

	const col: CollectionInterface<T> = {
		add(content: T, nodeOpts?: MemoryNodeOptions): MemoryNodeInterface<T> {
			if (destroyed) throw new Error("Collection is destroyed");
			const node = memoryNode<T>(content, nodeOpts);
			_nodes.set(node.id, node);
			_trackTags(node);
			_evictionPolicy?.insert(node.id);
			_evictIfNeeded();
			_syncNodesStore();
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
			_syncNodesStore();
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
				teardown(_nodesStore);
			});
		},
	};

	return col;
}
