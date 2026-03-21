// ---------------------------------------------------------------------------
// memoryStore — AI/LLM memory management pattern
// ---------------------------------------------------------------------------
// Three-tier memory architecture for AI agents:
// - Session memory: current conversation context (unbounded, cleared on reset)
// - Working memory: active context window (bounded, FIFO eviction)
// - Long-term memory: persistent knowledge (bounded, decay-scored eviction)
//
// Built on: collection, memoryNode, computeScore, reactiveMap
// ---------------------------------------------------------------------------

import { derived } from "../../core/derived";
import { teardown } from "../../core/protocol";
import { state } from "../../core/state";
import type { Store } from "../../core/types";
import { collection } from "../../memory/collection";
import type { Collection, MemoryNode, MemoryNodeOptions, ScoreWeights } from "../../memory/types";

export interface MemoryStoreOptions {
	/** Debug name. */
	name?: string;
	/** Max items in working memory. Default: 20 */
	workingCapacity?: number;
	/** Max items in long-term memory. Default: 1000 */
	longTermCapacity?: number;
	/** Score weights for long-term memory eviction and recall. */
	weights?: ScoreWeights;
}

export interface MemoryStoreResult<T> {
	// --- Session memory (ephemeral, current conversation) ---
	/** Add to session memory. */
	remember: (content: T, opts?: MemoryNodeOptions) => MemoryNode<T>;
	/** All session memories. */
	session: Store<MemoryNode<T>[]>;

	// --- Working memory (bounded active context) ---
	/** Add to working memory. Evicts oldest if at capacity. */
	focus: (content: T, opts?: MemoryNodeOptions) => MemoryNode<T>;
	/** All working memory items. */
	working: Store<MemoryNode<T>[]>;

	// --- Long-term memory (decay-scored, persistent) ---
	/** Store in long-term memory. Lowest-scoring memories evicted at capacity. */
	store: (content: T, opts?: MemoryNodeOptions) => MemoryNode<T>;
	/** All long-term memories. */
	longTerm: Store<MemoryNode<T>[]>;

	// --- Cross-tier operations ---
	/** Promote a memory from session/working to long-term. */
	promote: (nodeId: string) => boolean;
	/** Recall top-K memories across all tiers by score. */
	recall: (k: number, weights?: ScoreWeights) => MemoryNode<T>[];
	/** Recall memories by tag across all tiers. */
	recallByTag: (tag: string) => MemoryNode<T>[];
	/** Search across all tiers with a filter. */
	search: (filter: (node: MemoryNode<T>) => boolean) => MemoryNode<T>[];

	// --- Lifecycle ---
	/** Clear session memory (keeps working + long-term). */
	resetSession: () => void;
	/** Clear everything. */
	destroy: () => void;

	// --- Reactive stats ---
	/** Total memories across all tiers. */
	totalSize: Store<number>;
}

/**
 * Creates a three-tier memory store for AI/LLM applications.
 *
 * @param opts - Optional configuration for capacity and scoring.
 *
 * @returns `MemoryStoreResult<T>` — session, working, and long-term memory with cross-tier operations.
 *
 * @remarks **Session memory:** Unbounded, ephemeral. Cleared on `resetSession()`. For current conversation context.
 * @remarks **Working memory:** Bounded (FIFO eviction). For active context window the agent is currently reasoning about.
 * @remarks **Long-term memory:** Bounded (decay-scored eviction). For persistent knowledge across conversations.
 * @remarks **Promotion:** `promote()` moves a memory from session/working to long-term, preserving metadata.
 *
 * @example
 * ```ts
 * import { memoryStore } from 'callbag-recharge/patterns/memoryStore';
 *
 * const memory = memoryStore<string>({ workingCapacity: 10, longTermCapacity: 100 });
 *
 * // Current conversation
 * memory.remember('User prefers TypeScript');
 *
 * // Active reasoning context
 * memory.focus('Current task: refactor auth module', { tags: ['task'] });
 *
 * // Persistent knowledge
 * memory.store('Project uses callbag-recharge for state', {
 *   tags: ['architecture'],
 *   importance: 0.9,
 * });
 *
 * // Cross-tier recall
 * const relevant = memory.recall(5); // top 5 across all tiers
 * const tagged = memory.recallByTag('architecture');
 *
 * // New conversation
 * memory.resetSession(); // clears session, keeps working + long-term
 * ```
 *
 * @category patterns
 */
export function memoryStore<T>(opts?: MemoryStoreOptions): MemoryStoreResult<T> {
	const workingCap = opts?.workingCapacity ?? 20;
	const longTermCap = opts?.longTermCapacity ?? 1000;
	const weights = opts?.weights ?? {};

	// Three-tier collections (session is mutable — recreated on resetSession)
	let _session = collection<T>();
	const _working = collection<T>({ maxSize: workingCap });
	const _longTerm = collection<T>({ maxSize: longTermCap, weights });

	// Session version counter — bumped on resetSession to invalidate derived stores
	const _sessionVersion = state<number>(0);

	// Reactive total size — depends on sessionVersion to re-read after reset
	const totalSize = derived([_sessionVersion, _working.size, _longTerm.size], () => {
		_sessionVersion.get(); // subscribe to session resets
		return (
			_session.size.get() +
			(_working.size as Store<number>).get() +
			(_longTerm.size as Store<number>).get()
		);
	});

	function remember(content: T, nodeOpts?: MemoryNodeOptions): MemoryNode<T> {
		return _session.add(content, nodeOpts);
	}

	function focus(content: T, nodeOpts?: MemoryNodeOptions): MemoryNode<T> {
		return _working.add(content, nodeOpts);
	}

	function storeMem(content: T, nodeOpts?: MemoryNodeOptions): MemoryNode<T> {
		return _longTerm.add(content, nodeOpts);
	}

	function promote(nodeId: string): boolean {
		// Try to find in session first, then working
		let source: Collection<T> | null = null;
		let node = _session.get(nodeId);
		if (node) {
			source = _session;
		} else {
			node = _working.get(nodeId);
			if (node) source = _working;
		}

		if (!node || !source) return false;

		// Copy to long-term, preserving metadata (importance, tags, accessCount)
		const meta = node.meta.get();
		const promoted = _longTerm.add(node.content.get(), {
			id: meta.id,
			importance: meta.importance,
			tags: Array.from(meta.tags),
		});
		// Replay access count so scoring reflects original history
		for (let i = 0; i < meta.accessCount; i++) promoted.touch();

		// Remove from source tier
		source.remove(nodeId);
		return true;
	}

	function recall(k: number, w?: ScoreWeights): MemoryNode<T>[] {
		const effectiveWeights = w ?? weights;
		// Gather from all tiers
		const all: MemoryNode<T>[] = [
			..._session.topK(k, effectiveWeights),
			..._working.topK(k, effectiveWeights),
			..._longTerm.topK(k, effectiveWeights),
		];

		// Re-rank and take top-K
		all.sort((a, b) => b.score(effectiveWeights) - a.score(effectiveWeights));

		// Touch recalled memories (updates accessedAt + accessCount)
		const result = all.slice(0, k);
		for (const node of result) node.touch();
		return result;
	}

	function recallByTag(tag: string): MemoryNode<T>[] {
		return [..._session.byTag(tag), ..._working.byTag(tag), ..._longTerm.byTag(tag)];
	}

	function search(filter: (node: MemoryNode<T>) => boolean): MemoryNode<T>[] {
		return [..._session.query(filter), ..._working.query(filter), ..._longTerm.query(filter)];
	}

	function resetSession(): void {
		_session.destroy();
		_session = collection<T>();
		_sessionVersion.update((v) => v + 1);
	}

	function destroy(): void {
		_session.destroy();
		_working.destroy();
		_longTerm.destroy();
		// Teardown reactive stores — cascades END to subscribers of
		// totalSize, sessionNodes, and sessionVersion.
		teardown(_sessionVersion);
	}

	// Session nodes: re-read from _session on version change
	const sessionNodes = derived([_sessionVersion], () => {
		_sessionVersion.get();
		return _session.nodes.get();
	});

	return {
		remember,
		session: sessionNodes as Store<MemoryNode<T>[]>,
		focus,
		working: _working.nodes,
		store: storeMem,
		longTerm: _longTerm.nodes,
		promote,
		recall,
		recallByTag,
		search,
		resetSession,
		destroy,
		totalSize,
	};
}
