// ---------------------------------------------------------------------------
// agentMemory — Mem0-equivalent reactive agentic memory
// ---------------------------------------------------------------------------
// Drop-in agentic memory product. Pass conversation messages → LLM extracts
// facts → embeddings for semantic search → dedup via cosine similarity →
// persistence via checkpoint adapter. Reactive stores for status, results,
// and memory count.
//
// Built on: collection (memory/), vectorIndex (memory/), fromLLM (ai/),
// subscribe (core/), rawFromAny + rawSubscribe (raw/)
// ---------------------------------------------------------------------------

import { batch, teardown } from "../../core/protocol";
import { state } from "../../core/state";
import { subscribe } from "../../core/subscribe";
import { collection } from "../../memory/collection";
import { vectorIndex as createVectorIndex } from "../../memory/vectorIndex";
import { rawFromAny } from "../../raw/fromAny";
import { rawSubscribe } from "../../raw/subscribe";
import { checkDedup } from "./dedup";
import { buildExtractionMessages, parseFacts } from "./extraction";
import { autoPersist } from "./persistence";
import type {
	AgentMemoryOptions,
	AgentMemoryResult,
	AgentMemoryScope,
	AgentMemorySearchResult,
	AgentMemoryStatus,
	ExtractedFact,
} from "./types";

const SCOPE_PREFIX = "scope:";

function scopeTags(scope?: AgentMemoryScope): string[] {
	if (!scope) return [];
	const tags: string[] = [];
	if (scope.userId) tags.push(`${SCOPE_PREFIX}user:${scope.userId}`);
	if (scope.agentId) tags.push(`${SCOPE_PREFIX}agent:${scope.agentId}`);
	if (scope.tags) {
		for (const t of scope.tags) tags.push(`${SCOPE_PREFIX}${t}`);
	}
	return tags;
}

function matchesScope(nodeTags: Set<string>, requiredTags: string[]): boolean {
	for (const t of requiredTags) {
		if (!nodeTags.has(t)) return false;
	}
	return true;
}

/**
 * Creates a reactive agentic memory — a Mem0-equivalent drop-in memory layer.
 *
 * @param opts - Configuration: LLM, embedding function, persistence, thresholds.
 *
 * @returns `AgentMemoryResult` — add/search/getAll/update/delete operations,
 *   reactive stores for status/results/size, and underlying collection/vectorIndex.
 *
 * @remarks **Auto-extraction:** `add()` passes messages through the LLM to extract
 *   structured facts. Facts are embedded, dedup-checked, and stored.
 * @remarks **Semantic search:** `search()` embeds the query and finds nearest memories
 *   via HNSW vector index, filtered by scope.
 * @remarks **Dedup:** On add, checks cosine similarity against existing memories.
 *   If above `dedupThreshold`, updates the existing memory instead of adding.
 * @remarks **Persistence:** When `adapter` is provided, auto-saves on every structural
 *   change (add/remove/update) and restores on creation.
 * @remarks **Scoping:** User/agent isolation via tag-based namespacing. `byTag()` gives
 *   O(1) lookups via reactiveIndex.
 *
 * @example
 * ```ts
 * import { agentMemory, fromLLM, indexedDBAdapter } from 'callbag-recharge/ai';
 *
 * const mem = agentMemory({
 *   llm: fromLLM({ provider: 'openai', apiKey: 'sk-...', model: 'gpt-4o-mini' }),
 *   embed: async (text) => embedder(text),
 *   dimensions: 384,
 *   adapter: indexedDBAdapter(),
 * });
 *
 * mem.add([
 *   { role: 'user', content: 'I love TypeScript and hate Java' },
 * ], { userId: 'alice' });
 *
 * // After extraction completes:
 * mem.search('what languages?', { userId: 'alice' });
 * // mem.results.get() → [{ node: ..., score: 0.92 }]
 * ```
 *
 * @category ai
 */
export function agentMemory(opts: AgentMemoryOptions): AgentMemoryResult {
	const name = opts.name ?? "agentMemory";
	const maxSize = opts.maxSize ?? 10000;
	const dedupThreshold = opts.dedupThreshold ?? 0.85;
	const llm = opts.llm;
	const embed = opts.embed;

	// Core data structures
	const col = collection<string>({ maxSize, weights: opts.weights });
	const vi = createVectorIndex({ dimensions: opts.dimensions });
	const _embeddings = new Map<string, Float32Array | number[]>();

	// Reactive state
	const _status = state<AgentMemoryStatus>("idle", { name: `${name}.status` });
	const _error = state<unknown | undefined>(undefined, { name: `${name}.error` });
	const _results = state<AgentMemorySearchResult[]>([], { name: `${name}.results` });
	const _lastExtracted = state<ExtractedFact[]>([], { name: `${name}.lastExtracted` });

	// Persistence
	const _persist = opts.adapter ? autoPersist(col, vi, _embeddings, opts.adapter, name) : null;
	_persist?.restore();

	// Track active operations for cancellation
	let _addAbort: AbortController | null = null;
	let _searchAbort: AbortController | null = null;

	// Listen for LLM completion to process extracted facts
	let _llmSub: { unsubscribe(): void } | null = null;

	// Generation counter to guard against stale LLM completions (P2)
	let _addGeneration = 0;

	function add(messages: Array<{ role: string; content: string }>, scope?: AgentMemoryScope): void {
		// Cancel any in-progress add
		_addAbort?.abort();
		_addAbort = new AbortController();
		const signal = _addAbort.signal;
		const tags = scopeTags(scope);
		const generation = ++_addGeneration;

		batch(() => {
			_status.set("extracting");
			_error.set(undefined);
		});

		// Clean up previous LLM subscription before generating
		_llmSub?.unsubscribe();

		// Build extraction messages and generate
		const extractionMessages = buildExtractionMessages(messages, opts.extractionPrompt);
		llm.generate(extractionMessages);

		// Subscribe to LLM status for completion
		// Note: core/subscribe does NOT emit the initial value (RxJS semantics),
		// so no guard needed against stale "completed" from a prior add().
		// The generation counter protects against cross-add() interference.
		_llmSub = subscribe(llm.status, (status) => {
			if (signal.aborted || generation !== _addGeneration) return;

			if (status === "completed") {
				const output = llm.get();
				const facts = parseFacts(output);

				if (facts.length === 0) {
					batch(() => {
						_status.set("idle");
						_lastExtracted.set([]);
					});
					return;
				}

				_status.set("embedding");
				embedAndStore(facts, tags, signal);
			} else if (status === "errored") {
				batch(() => {
					_error.set(llm.error.get());
					_status.set("error");
				});
			}
		});
	}

	function embedAndStore(facts: ExtractedFact[], tags: string[], signal: AbortSignal): void {
		let settled = 0; // P1: track both successes and failures

		for (const fact of facts) {
			if (signal.aborted) return;

			rawSubscribe(
				rawFromAny(embed(fact.content)),
				(embedding: Float32Array | number[]) => {
					if (signal.aborted) return;

					const dedup = checkDedup(vi, embedding, dedupThreshold);

					if (dedup.isDuplicate && dedup.existingId) {
						// Update existing memory
						const existing = col.get(dedup.existingId);
						if (existing) {
							existing.update(fact.content);
							existing.setImportance(Math.max(existing.meta.get().importance, fact.importance));
							for (const t of fact.tags) existing.tag(t);
							for (const t of tags) existing.tag(t);
						}
						vi.add(dedup.existingId, embedding);
						_embeddings.set(dedup.existingId, embedding);
					} else {
						// Add new memory
						const allTags = [...fact.tags, ...tags];
						const node = col.add(fact.content, {
							importance: fact.importance,
							tags: allTags,
						});
						if (node) {
							vi.add(node.id, embedding);
							_embeddings.set(node.id, embedding);
						}
					}

					settled++;
					if (settled === facts.length) {
						batch(() => {
							_status.set("idle");
							_lastExtracted.set(facts);
						});
					}
				},
				{
					onEnd: (err?: unknown) => {
						if (signal.aborted) return;
						settled++; // P1: count failures toward settlement
						if (err !== undefined) {
							batch(() => {
								_error.set(err);
								_status.set("error");
							});
						} else if (settled === facts.length) {
							// All settled (some may have had no DATA emission)
							batch(() => {
								_status.set("idle");
								_lastExtracted.set(facts);
							});
						}
					},
				},
			);
		}
	}

	function search(query: string, scope?: AgentMemoryScope, k = 10): void {
		// Cancel any in-progress search
		_searchAbort?.abort();
		_searchAbort = new AbortController();
		const signal = _searchAbort.signal;
		const tags = scopeTags(scope);

		batch(() => {
			_status.set("searching");
			_error.set(undefined);
		});

		rawSubscribe(
			rawFromAny(embed(query)),
			(embedding: Float32Array | number[]) => {
				if (signal.aborted) return;

				// Overfetch for scope filtering
				const raw = vi.search(embedding, k * 2);
				const results: AgentMemorySearchResult[] = [];

				for (const r of raw) {
					if (results.length >= k) break;
					const node = col.get(r.id);
					if (!node) continue;

					// Scope filtering
					if (tags.length > 0 && !matchesScope(node.meta.get().tags, tags)) {
						continue;
					}

					results.push({ node, score: Math.max(0, 1 - r.distance) });
					node.touch();
				}

				batch(() => {
					_results.set(results);
					_status.set("idle");
				});
			},
			{
				onEnd: (err?: unknown) => {
					if (err !== undefined && !signal.aborted) {
						batch(() => {
							_error.set(err);
							_status.set("error");
						});
					}
				},
			},
		);
	}

	function getAll(scope?: AgentMemoryScope): ReturnType<AgentMemoryResult["getAll"]> {
		const tags = scopeTags(scope);
		if (tags.length === 0) return col.nodes.get();

		// Use the first scope tag for O(1) lookup, then filter rest
		const candidates = col.byTag(tags[0]);
		if (tags.length === 1) return candidates;

		return candidates.filter((node) => matchesScope(node.meta.get().tags, tags));
	}

	function update(id: string, content: string): void {
		const node = col.get(id);
		if (!node) return;

		node.update(content);

		// Re-embed asynchronously
		rawSubscribe(
			rawFromAny(embed(content)),
			(embedding: Float32Array | number[]) => {
				vi.add(id, embedding);
				_embeddings.set(id, embedding);
			},
			{
				onEnd: (err?: unknown) => {
					if (err !== undefined) {
						_error.set(err);
					}
				},
			},
		);
	}

	function del(id: string): boolean {
		vi.remove(id);
		_embeddings.delete(id);
		return col.remove(id);
	}

	function destroy(): void {
		_addAbort?.abort();
		_searchAbort?.abort();
		_llmSub?.unsubscribe();
		_persist?.dispose();
		col.destroy();
		vi.destroy();
		_embeddings.clear();
		teardown(_status);
		teardown(_error);
		teardown(_results);
		teardown(_lastExtracted);
	}

	return {
		add,
		search,
		results: _results,
		getAll,
		update,
		delete: del,
		status: _status,
		error: _error,
		size: col.size,
		lastExtracted: _lastExtracted,
		inner: {
			collection: col,
			vectorIndex: vi,
		},
		destroy,
	};
}
