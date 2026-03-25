import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocIndexResult, SearchResult } from "../../../ai/docIndex";
import type { EmbeddingIndexResult, ScoredDoc } from "../../../ai/embeddingIndex";
import type { LLMStore } from "../../../ai/fromLLM";
import { ragPipeline } from "../../../ai/ragPipeline";
import { state } from "../../../core/state";
import type { Store } from "../../../core/types";
import type { WithStatusStatus } from "../../../utils/withStatus";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeMockDocSearch(initialResults: SearchResult[] = []): DocIndexResult & {
	_results: Store<SearchResult[]>;
} {
	const results = state<SearchResult[]>(initialResults);
	const loaded = state<boolean>(true);
	const error = state<unknown | undefined>(undefined);
	const search = vi.fn((_q: string) => {
		// No-op by default; tests override with mockImplementation
	});
	return {
		results,
		loaded,
		error,
		search,
		destroy: vi.fn(),
		_results: results,
	};
}

function makeMockSemanticSearch(initialResults: ScoredDoc[] = []): EmbeddingIndexResult {
	const results = state<ScoredDoc[]>(initialResults);
	const loaded = state<boolean>(true);
	const error = state<unknown | undefined>(undefined);
	const search = vi.fn();
	return {
		results,
		loaded,
		error,
		search,
		destroy: vi.fn(),
	};
}

function makeMockLLM(): LLMStore {
	const status = state<WithStatusStatus>("pending");
	const error = state<unknown | undefined>(undefined);
	const tokens = state<Record<string, unknown>>({});
	return {
		get: vi.fn(() => ""),
		source: vi.fn(),
		status,
		error,
		tokens,
		generate: vi.fn(),
		abort: vi.fn(),
	};
}

// ---------------------------------------------------------------------------
// ragPipeline tests
// ---------------------------------------------------------------------------

describe("ragPipeline", () => {
	let rag: ReturnType<typeof ragPipeline> | null = null;

	afterEach(() => {
		rag?.destroy();
		rag = null;
	});

	it("docs starts as empty array", () => {
		const query = state("");
		const docSearch = makeMockDocSearch();
		const llm = makeMockLLM();

		rag = ragPipeline({ query, docSearch, llm });

		expect(rag.docs.get()).toEqual([]);
	});

	it("context starts as empty string", () => {
		const query = state("");
		const docSearch = makeMockDocSearch();
		const llm = makeMockLLM();

		rag = ragPipeline({ query, docSearch, llm });

		expect(rag.context.get()).toBe("");
	});

	it("generating starts as false", () => {
		const query = state("");
		const docSearch = makeMockDocSearch();
		const llm = makeMockLLM();

		rag = ragPipeline({ query, docSearch, llm });

		expect(rag.generating.get()).toBe(false);
	});

	it("query triggers docSearch.search()", async () => {
		const query = state("");
		const docSearch = makeMockDocSearch();
		const llm = makeMockLLM();

		rag = ragPipeline({ query, docSearch, llm });

		query.set("How do derived stores work?");

		await vi.waitFor(() =>
			expect(docSearch.search).toHaveBeenCalledWith("How do derived stores work?"),
		);
	});

	it("query triggers llm.generate() with system+user messages", async () => {
		const query = state("");
		const docSearch = makeMockDocSearch();
		const llm = makeMockLLM();

		rag = ragPipeline({ query, docSearch, llm });

		query.set("What is a derived store?");

		await vi.waitFor(() => expect(llm.generate).toHaveBeenCalled());

		const calls = (llm.generate as ReturnType<typeof vi.fn>).mock.calls;
		const messages = calls[0][0];
		expect(messages).toHaveLength(2);
		expect(messages[0].role).toBe("system");
		expect(messages[1].role).toBe("user");
		expect(messages[1].content).toBe("What is a derived store?");
	});

	it("context includes systemPrompt in generate messages", async () => {
		const query = state("");
		const docSearch = makeMockDocSearch();
		const llm = makeMockLLM();

		rag = ragPipeline({ query, docSearch, llm, systemPrompt: "You are a helpful assistant." });

		query.set("test query");

		await vi.waitFor(() => expect(llm.generate).toHaveBeenCalled());

		const messages = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(messages[0].content).toContain("You are a helpful assistant.");
	});

	it("merged docs from docSearch only (no semanticSearch)", async () => {
		const query = state("");
		const results: SearchResult[] = [
			{
				id: "doc-1",
				title: "Derived Stores",
				excerpt: "Use derived for computed values",
				score: -1,
				source: "core.md",
				tags: [],
			},
		];
		const docSearch = makeMockDocSearch();
		(docSearch.search as ReturnType<typeof vi.fn>).mockImplementation(() => {
			docSearch.results.set(results);
		});
		const llm = makeMockLLM();

		rag = ragPipeline({ query, docSearch, llm });

		query.set("derived stores");

		await vi.waitFor(() => expect(rag!.docs.get()).toHaveLength(1));

		const docs = rag.docs.get();
		expect(docs[0].id).toBe("doc-1");
		expect(docs[0].title).toBe("Derived Stores");
	});

	it("deduplication: doc and semantic results with same id are deduped", async () => {
		const query = state("");
		const docResults: SearchResult[] = [
			{
				id: "shared-1",
				title: "Shared Doc",
				excerpt: "shared excerpt",
				score: -1,
				source: "src.md",
				tags: [],
			},
		];
		const semResults: ScoredDoc[] = [
			{
				id: "shared-1",
				score: 0.9,
				metadata: { title: "Shared Doc Sem", source: "src.md", excerpt: "sem excerpt" },
			},
			{
				id: "sem-only",
				score: 0.8,
				metadata: { title: "Sem Only", source: "sem.md", excerpt: "sem only excerpt" },
			},
		];

		const docSearch = makeMockDocSearch();
		(docSearch.search as ReturnType<typeof vi.fn>).mockImplementation(() => {
			docSearch.results.set(docResults);
		});

		const semanticSearch = makeMockSemanticSearch();
		(semanticSearch.search as ReturnType<typeof vi.fn>).mockImplementation(() => {
			(semanticSearch.results as ReturnType<typeof state<ScoredDoc[]>>).set(semResults);
		});
		// Not loaded so we skip the firstValueFrom wait
		(semanticSearch.loaded as ReturnType<typeof state<boolean>>).set(false);

		const llm = makeMockLLM();

		rag = ragPipeline({ query, docSearch, semanticSearch, llm });

		// Manually set both stores to trigger derived update
		docSearch.results.set(docResults);
		(semanticSearch.results as ReturnType<typeof state<ScoredDoc[]>>).set(semResults);

		await vi.waitFor(() => expect(rag!.docs.get().length).toBeGreaterThan(0));

		const docs = rag.docs.get();
		const ids = docs.map((d) => d.id);
		// shared-1 should appear only once
		expect(ids.filter((id) => id === "shared-1")).toHaveLength(1);
		// sem-only should also be present
		expect(ids).toContain("sem-only");
	});

	it("empty query aborts llm and skips generation", () => {
		const query = state("some query");
		const docSearch = makeMockDocSearch();
		const llm = makeMockLLM();

		rag = ragPipeline({ query, docSearch, llm });

		// Reset mock calls from any initial trigger
		(llm.generate as ReturnType<typeof vi.fn>).mockClear();
		(llm.abort as ReturnType<typeof vi.fn>).mockClear();

		query.set("   ");

		expect(llm.abort).toHaveBeenCalled();
		expect(llm.generate).not.toHaveBeenCalled();
	});

	it("changing query calls llm.generate() again", async () => {
		const query = state("");
		const docSearch = makeMockDocSearch();
		const llm = makeMockLLM();

		rag = ragPipeline({ query, docSearch, llm });

		query.set("first query");
		await vi.waitFor(() =>
			expect((llm.generate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1),
		);

		query.set("second query");
		await vi.waitFor(() =>
			expect((llm.generate as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2),
		);

		const secondCall = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[1][0];
		expect(secondCall[1].content).toBe("second query");
	});

	it("docs derived store updates when docSearch results change", async () => {
		const query = state("");
		const docSearch = makeMockDocSearch();
		const llm = makeMockLLM();

		rag = ragPipeline({ query, docSearch, llm });

		expect(rag.docs.get()).toEqual([]);

		docSearch.results.set([
			{ id: "doc-a", title: "Doc A", excerpt: "excerpt a", score: -1, source: "a.md", tags: [] },
		]);

		await vi.waitFor(() => expect(rag!.docs.get()).toHaveLength(1));
		expect(rag.docs.get()[0].id).toBe("doc-a");
	});

	it("context derived store includes summary when provided", async () => {
		const query = state("");
		const docSearch = makeMockDocSearch();
		const llm = makeMockLLM();
		const summary = state("Previous conversation summary here.");

		rag = ragPipeline({ query, docSearch, llm, summary });

		await vi.waitFor(() => expect(rag!.context.get()).toContain("SUMMARY:"));
		expect(rag.context.get()).toContain("Previous conversation summary here.");
	});

	it("memory context injected when memory provided", async () => {
		const query = state("");
		const docSearch = makeMockDocSearch();
		const llm = makeMockLLM();

		// Minimal memory mock
		const sessionStore = state<Array<{ content: { get(): string }; score(): number }>>([]);
		const memory = {
			session: sessionStore as unknown as Store<any[]>,
			recall: vi
				.fn()
				.mockReturnValue([{ content: { get: () => "User prefers TypeScript" }, score: () => 1 }]),
			query: vi
				.fn()
				.mockReturnValue([{ content: { get: () => "User prefers TypeScript" }, score: () => 1 }]),
			remember: vi.fn(),
			focus: vi.fn(),
			working: state([]),
			store: vi.fn(),
			longTerm: state([]),
			promote: vi.fn(),
			recallByTag: vi.fn(),
			search: vi.fn(),
			resetSession: vi.fn(),
			destroy: vi.fn(),
			totalSize: state(0),
		};

		// Trigger context re-derive by setting session
		sessionStore.set([]);

		rag = ragPipeline({ query, docSearch, llm, memory });

		// Trigger re-derive
		sessionStore.set([]);

		await vi.waitFor(() => {
			const ctx = rag!.context.get();
			return ctx.includes("USER CONTEXT:") && ctx.includes("User prefers TypeScript");
		});
	});

	it("destroy() cleans up without errors", () => {
		const query = state("");
		const docSearch = makeMockDocSearch();
		const llm = makeMockLLM();

		rag = ragPipeline({ query, docSearch, llm });

		expect(() => rag!.destroy()).not.toThrow();
		rag = null; // prevent afterEach double-destroy
	});
});
