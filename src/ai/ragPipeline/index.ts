// ---------------------------------------------------------------------------
// ragPipeline — reactive RAG: retrieve → augment → generate
// ---------------------------------------------------------------------------
// Wires docIndex + embeddingIndex + fromLLM + memoryStore into a reactive
// retrieve-augment-generate pipeline. Takes a reactive query store; fires
// searches and LLM generation on every non-empty change.
//
// Reactive: context and docs are derived stores that update whenever any
// search source changes. Generation is triggered by the query store.
//
// Built on: derived, subscribe, latestAsync, firstValueFrom, rawSkip
// ---------------------------------------------------------------------------

import { derived } from "../../core/derived";
import { teardown } from "../../core/protocol";
import { subscribe } from "../../core/subscribe";
import type { Store } from "../../core/types";
import { firstValueFrom } from "../../raw/firstValueFrom";
import { latestAsync } from "../../raw/latestAsync";
import { rawSkip } from "../../raw/skip";
import type { DocIndexResult, SearchResult } from "../docIndex";
import type { EmbeddingIndexResult, ScoredDoc } from "../embeddingIndex";
import type { LLMMessage, LLMStore } from "../fromLLM";
import type { MemoryStoreResult } from "../memoryStore";

export interface RagDoc {
	/** Chunk ID. */
	id: string;
	/** Document title. */
	title: string;
	/** Highlighted excerpt or description. */
	excerpt: string;
	/** Relevance score (FTS5 rank or cosine similarity). */
	score: number;
	/** Origin file or section. */
	source: string;
}

export interface RagPipelineOptions {
	/**
	 * Reactive query input — pipeline fires whenever this store changes.
	 * Set to a non-empty string to trigger retrieval + generation.
	 */
	query: Store<string>;
	/** FTS5 document search source (from docIndex). */
	docSearch: DocIndexResult;
	/** Optional semantic search source (from embeddingIndex). Results merged + deduped with docSearch. */
	semanticSearch?: EmbeddingIndexResult;
	/**
	 * Optional memory store. Top-3 session memories injected as USER CONTEXT.
	 * `memory.session` is included in deps so context re-derives on session changes.
	 */
	memory?: MemoryStoreResult<string>;
	/** Optional rolling summary store (from conversationSummary). Injected as SUMMARY. */
	summary?: Store<string>;
	/** Base system prompt prepended before context sections. */
	systemPrompt?: string;
	/** LLM store (from fromLLM). Receives assembled context + user query messages. */
	llm: LLMStore;
	/** Max results to include from each search source. Default: 5 */
	maxResults?: number;
	/** Debug name. */
	name?: string;
}

export interface RagPipelineResult {
	/** Reactive assembled system context. Updates when search results, summary, or memory change. */
	context: Store<string>;
	/** Reactive merged + deduped retrieved docs. Updates when search results change. */
	docs: Store<RagDoc[]>;
	/** True while LLM is generating (derived from llm.status). */
	generating: Store<boolean>;
	/** Last LLM error, if any (delegates to llm.error). */
	error: Store<unknown | undefined>;
	/** Tear down all subscriptions and derived stores. Does NOT destroy the passed llm/docSearch/etc. */
	destroy(): void;
}

function mergeAndDedup(
	docResults: SearchResult[],
	semResults: ScoredDoc[],
	maxResults: number,
): RagDoc[] {
	const seen = new Set<string>();
	const merged: RagDoc[] = [];

	for (const r of docResults.slice(0, maxResults)) {
		if (!seen.has(r.id)) {
			seen.add(r.id);
			merged.push({
				id: r.id,
				title: r.title,
				excerpt: r.excerpt,
				score: r.score,
				source: r.source,
			});
		}
	}

	for (const r of semResults.slice(0, maxResults)) {
		if (!seen.has(r.id)) {
			seen.add(r.id);
			merged.push({
				id: r.id,
				title: String(r.metadata.title ?? r.id),
				excerpt: String(r.metadata.excerpt ?? ""),
				score: r.score,
				source: String(r.metadata.source ?? ""),
			});
		}
	}

	return merged;
}

function buildContextString(
	docs: RagDoc[],
	memCtx: string,
	summaryCtx: string,
	systemPrompt: string | undefined,
): string {
	const sections: string[] = [];
	if (systemPrompt) sections.push(systemPrompt);
	if (summaryCtx) sections.push(`SUMMARY:\n${summaryCtx}`);
	if (memCtx) sections.push(`USER CONTEXT:\n${memCtx}`);
	if (docs.length > 0) {
		const docsText = docs.map((d, i) => `[${i + 1}] ${d.title}\n${d.excerpt}`).join("\n\n");
		sections.push(`SEARCH RESULTS:\n${docsText}`);
	}
	return sections.join("\n\n");
}

/**
 * Creates a reactive retrieve-augment-generate pipeline.
 *
 * @param opts - Pipeline configuration (query store, search sources, LLM store).
 *
 * @returns `RagPipelineResult` — reactive `context`, `docs`, `generating`, `error` stores + `destroy()`.
 *
 * @remarks **Reactive query:** Set `opts.query` to a non-empty string to trigger retrieval + generation.
 * @remarks **Async semantic search:** If `semanticSearch` is provided and loaded, waits for embedding
 *   result before generating. Uses `latestAsync` to cancel stale in-flight searches on rapid query changes.
 * @remarks **Context assembly:** `SYSTEM PROMPT` → `SUMMARY` → `USER CONTEXT` → `SEARCH RESULTS`.
 * @remarks **Cleanup:** `destroy()` cancels in-flight searches, unsubscribes from query, and tears down
 *   derived stores. Does not destroy passed-in stores (llm, docSearch, etc.).
 *
 * @example
 * ```ts
 * import { state } from 'callbag-recharge';
 * import { ragPipeline, docIndex, fromLLM } from 'callbag-recharge/ai';
 *
 * const query = state('');
 * const docs = docIndex({ db: '/docs-index.db' });
 * const llm = fromLLM({ provider: 'ollama', model: 'llama4' });
 *
 * const rag = ragPipeline({ query, docSearch: docs, llm });
 *
 * // Trigger retrieval + generation
 * query.set('How do I use derived stores?');
 * // rag.generating.get() → true
 * // rag.context.get() → "SEARCH RESULTS:\n[1] ..."
 * // llm.get() → accumulating response...
 * ```
 *
 * @category ai
 */
export function ragPipeline(opts: RagPipelineOptions): RagPipelineResult {
	const maxResults = opts.maxResults ?? 5;

	// --- Reactive derived stores ---

	// docs: merge + dedup from both search sources
	const resultDeps: Store<unknown>[] = [opts.docSearch.results];
	if (opts.semanticSearch) resultDeps.push(opts.semanticSearch.results);

	const docs = derived(resultDeps, () =>
		mergeAndDedup(
			opts.docSearch.results.get(),
			opts.semanticSearch?.results.get() ?? [],
			maxResults,
		),
	);

	// context: depends on docs (linear chain), plus optional summary + memory session
	const contextDeps: Store<unknown>[] = [docs];
	if (opts.summary) contextDeps.push(opts.summary);
	if (opts.memory) contextDeps.push(opts.memory.session as Store<unknown>);

	const context = derived(contextDeps, () => {
		const merged = docs.get();
		const memCtx =
			opts.memory
				?.query(3)
				.map((n) => String(n.content.get()))
				.join("\n") ?? "";
		const summaryCtx = opts.summary?.get() ?? "";
		return buildContextString(merged, memCtx, summaryCtx, opts.systemPrompt);
	});

	// generating: reactive flag from LLM status
	const generating = derived([opts.llm.status], () => opts.llm.status.get() === "active");

	// --- Async coordination ---

	// latestAsync: cancels stale in-flight RAG cycles on rapid query changes
	const latestGenerate = latestAsync(async (q: string, signal: AbortSignal) => {
		// Trigger both searches
		opts.docSearch.search(q);
		opts.semanticSearch?.search(q);

		// If semantic search is loaded, wait for its async result before generating.
		// rawSkip(1) discards the current store value (sync initial emit on subscription),
		// waiting only for the next DATA event (the embedding result for this query).
		// signal: when a newer query supersedes this one, latestAsync aborts the signal,
		// causing firstValueFrom to unsubscribe + reject — no subscription leak.
		if (opts.semanticSearch?.loaded.get()) {
			await firstValueFrom(rawSkip(1)(opts.semanticSearch.results.source), { signal });
		}
	});

	// --- Query subscription ---

	// subscribe (§1.19): single dep, no cleanup return, no diamond risk
	const querySub = subscribe(opts.query, (q) => {
		const trimmed = q.trim();
		if (!trimmed) {
			opts.llm.abort();
			return;
		}

		latestGenerate.call(
			trimmed,
			() => {
				// Both searches have settled; context.get() reflects latest results via derived chain
				const messages: LLMMessage[] = [
					{ role: "system", content: context.get() },
					{ role: "user", content: trimmed },
				];
				opts.llm.generate(messages);
			},
			() => {
				// Semantic search source errored or completed before emitting —
				// fall back to generating with whatever context is currently available.
				const messages: LLMMessage[] = [
					{ role: "system", content: context.get() },
					{ role: "user", content: trimmed },
				];
				opts.llm.generate(messages);
			},
		);
	});

	function destroy(): void {
		latestGenerate.cancel();
		querySub.unsubscribe();
		opts.llm.abort();
		// Tear down dependents before their dependencies
		teardown(generating);
		teardown(context);
		teardown(docs);
	}

	return { context, docs, generating, error: opts.llm.error, destroy };
}
