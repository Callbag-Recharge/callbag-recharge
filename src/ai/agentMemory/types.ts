// ---------------------------------------------------------------------------
// agentMemory types — Mem0-equivalent reactive agentic memory
// ---------------------------------------------------------------------------

import type { Store } from "../../core/types";
import type { Collection, MemoryNode, ScoreWeights, VectorIndex } from "../../memory/types";
import type { CheckpointAdapter } from "../../utils/checkpoint";
import type { LLMStore } from "../fromLLM";

/** Scope for user/agent isolation. Maps to tag-based namespace prefixes. */
export interface AgentMemoryScope {
	/** User ID for per-user memory isolation. */
	userId?: string;
	/** Agent ID for per-agent memory isolation. */
	agentId?: string;
	/** Additional scope tags for custom partitioning. */
	tags?: string[];
}

/** A structured fact extracted by the LLM from conversation messages. */
export interface ExtractedFact {
	/** The fact content (plain text). */
	content: string;
	/** Importance score (0–1) estimated by the LLM. */
	importance: number;
	/** Tags/categories assigned by the LLM. */
	tags: string[];
}

/** Embedding function signature — user-provided. */
export type EmbedFn = (text: string) => Promise<Float32Array | number[]>;

/** Status of the agentMemory pipeline. */
export type AgentMemoryStatus = "idle" | "extracting" | "embedding" | "searching" | "error";

export interface AgentMemoryOptions {
	/** LLM store for fact extraction (from `fromLLM`). */
	llm: LLMStore;
	/** Embedding function for semantic search and dedup. */
	embed: EmbedFn;
	/** Vector dimensions. Must match `embed` output length. */
	dimensions: number;
	/** Persistence adapter. When provided, auto-checkpoints on writes. */
	adapter?: CheckpointAdapter;
	/** Max memories. Default: 10000. */
	maxSize?: number;
	/** Score weights for eviction and recall. */
	weights?: ScoreWeights;
	/** Cosine similarity threshold for dedup. Default: 0.85 (0 = no dedup, 1 = exact match only). */
	dedupThreshold?: number;
	/** Custom extraction prompt (replaces default). */
	extractionPrompt?: string;
	/** Debug name. */
	name?: string;
}

/** A search result entry: memory node + similarity score. */
export interface AgentMemorySearchResult {
	/** The matched memory node. */
	node: MemoryNode<string>;
	/** Similarity score (0–1, higher = more similar). */
	score: number;
}

export interface AgentMemoryResult {
	/**
	 * Pass conversation messages to the LLM for automatic fact extraction.
	 * Extracted facts are embedded, deduped, and stored.
	 */
	add(messages: Array<{ role: string; content: string }>, scope?: AgentMemoryScope): void;

	/**
	 * Semantic search across all memories in scope.
	 * Updates the `results` store reactively.
	 */
	search(query: string, scope?: AgentMemoryScope, k?: number): void;

	/** Reactive search results (updated after `search()` call). */
	results: Store<AgentMemorySearchResult[]>;

	/** Get all memories in scope (snapshot). */
	getAll(scope?: AgentMemoryScope): MemoryNode<string>[];

	/** Update a specific memory's content. Re-embeds automatically. */
	update(id: string, content: string): void;

	/** Delete a specific memory. Returns true if found. */
	delete(id: string): boolean;

	/** Reactive pipeline status. */
	status: Store<AgentMemoryStatus>;

	/** Last error, if any (reactive). */
	error: Store<unknown | undefined>;

	/** Reactive memory count. */
	size: Store<number>;

	/** Facts extracted by the most recent `add()` call. */
	lastExtracted: Store<ExtractedFact[]>;

	/** Expert access to internal callbag primitives (per §1.14). */
	inner: {
		/** The underlying collection (for advanced queries: topK, byTag, gc, etc.). */
		collection: Collection<string>;
		/** The underlying vector index (for advanced vector operations). */
		vectorIndex: VectorIndex;
	};

	/** Tear down all internal state. */
	destroy(): void;
}
