// ---------------------------------------------------------------------------
// agentMemory types — Mem0-equivalent reactive agentic memory (SA-4)
// ---------------------------------------------------------------------------

import type { Store } from "../../core/types";
import type {
	Collection,
	KnowledgeGraph,
	MemoryNode,
	ScoreWeights,
	VectorIndex,
} from "../../memory/types";
import type { TopicBridgeResult } from "../../messaging/topicBridge";
import type { MessageFilter, MessageTransport } from "../../messaging/transportTypes";
import type { JobQueue, Topic } from "../../messaging/types";
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

/** An entity/relation extracted for knowledgeGraph integration (SA-4d). */
export interface ExtractedEntity {
	/** Entity name/label. */
	name: string;
	/** Entity content (description). */
	content: string;
	/** Entity type (person, concept, project, etc.). */
	type: string;
	/** Tags. */
	tags: string[];
}

/** A relation between two extracted entities. */
export interface ExtractedRelation {
	/** Source entity name. */
	source: string;
	/** Target entity name. */
	target: string;
	/** Relation type (e.g. "uses", "depends_on", "created_by"). */
	type: string;
	/** Relation weight (0–1). */
	weight?: number;
}

/** Graph extraction result from a single LLM pass. */
export interface GraphExtractionResult {
	entities: ExtractedEntity[];
	relations: ExtractedRelation[];
}

/** Embedding function signature — user-provided. Optionally accepts AbortSignal (SA-4i). */
export type EmbedFn = (text: string, signal?: AbortSignal) => Promise<Float32Array | number[]>;

/** Status of a single add/search operation. */
export type AgentMemoryOperationStatus =
	| "queued"
	| "active"
	| "completed"
	| "errored"
	| "cancelled";

/** Memory event types for the event topic (SA-4c). */
export type MemoryEventType = "add" | "update" | "delete";

/** Event published to the memory event topic (SA-4c). */
export interface MemoryEvent {
	/** Event type. */
	type: MemoryEventType;
	/** Memory node ID. */
	id: string;
	/** Content (present for add/update, absent for delete). */
	content?: string;
	/** Scope tags at time of event. */
	scopeTags?: string[];
	/** Timestamp (ms since epoch). */
	timestamp: number;
}

/** Internal job data for the extraction queue (SA-4a). */
export interface ExtractionJob {
	messages: Array<{ role: string; content: string }>;
	scope?: AgentMemoryScope;
	scopeTags: string[];
	batchId: number;
}

/** Extraction result used to preserve per-batch metadata. */
export interface ExtractionResult {
	facts: ExtractedFact[];
	scopeTags: string[];
	batchId: number;
}

/** Internal job data for the embedding queue (SA-4b). */
export interface EmbedJob {
	fact: ExtractedFact;
	/** Scope tags to apply to the stored memory. */
	scopeTags: string[];
	/** Extraction batch id for strict per-batch settlement. */
	batchId: number;
	/** Optional existing node ID for update() re-embedding. */
	targetId?: string;
}

/** Embedding result from the embed queue. */
export interface EmbedResult {
	fact: ExtractedFact;
	embedding: Float32Array | number[];
	scopeTags: string[];
	batchId: number;
	targetId?: string;
}

/** Internal job data for the graph extraction queue (SA-4d). */
export interface GraphExtractionJob {
	messages: Array<{ role: string; content: string }>;
	scope?: AgentMemoryScope;
}

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
	/** Embedding queue concurrency. Default: 4 (SA-4b). */
	embeddingConcurrency?: number;
	/** Extraction queue retries (SA-4a). Default: `{ maxRetries: 3 }`. */
	extractionRetry?: {
		/** Max retry attempts after the initial try. */
		maxRetries?: number;
	};
	/** Search overfetch multiplier. Default: 2 (SA-4h). */
	searchOverfetch?: number;
	/** Optional knowledgeGraph for entity/relation extraction (SA-4d). */
	knowledgeGraph?: KnowledgeGraph<string>;
	/** Custom graph extraction prompt (SA-4d). Used only when knowledgeGraph is provided. */
	graphExtractionPrompt?: string;
	/** Second LLM store for graph extraction (required when knowledgeGraph is provided). */
	graphLlm?: LLMStore;
	/**
	 * Optional shared-memory bridge configuration (SA-4e).
	 * When set, `inner.events` is bridged over the provided transport.
	 */
	shared?: {
		/** Transport used by topicBridge for cross-process sync. */
		transport: MessageTransport;
		/** Remote topic name. Default: `${name}:events`. */
		topicName?: string;
		/** Optional outgoing filter for memory events. */
		filter?: MessageFilter<MemoryEvent>;
		/** Optional bridge name. */
		bridgeName?: string;
	};
}

/** A search result entry: memory node + similarity score. */
export interface AgentMemorySearchResult {
	/** The matched memory node. */
	node: MemoryNode<string>;
	/** Similarity score (0–1, higher = more similar). */
	score: number;
}

/** Optional overrides for a single add() operation invocation. */
export interface AgentMemoryAddOptions {
	/** Caller-provided operation ID for tracing/correlation. */
	opId?: string;
}

/** Optional overrides for a single search() operation invocation. */
export interface AgentMemorySearchOptions {
	/** Caller-provided operation ID for tracing/correlation. */
	opId?: string;
}

/** Base reactive operation handle returned by add/search. */
export interface AgentMemoryOperationBase {
	/** Unique operation ID. */
	id: string;
	/** Reactive lifecycle status for this operation only. */
	status: Store<AgentMemoryOperationStatus>;
	/** Last operation error (if any). */
	error: Store<unknown | undefined>;
	/** Start timestamp (ms since epoch). */
	startedAt: number;
	/** End timestamp after completion/error/cancel. */
	endedAt: Store<number | undefined>;
	/** Cancel this specific operation. */
	cancel(): void;
}

/** Operation handle returned by add(). */
export interface AgentMemoryAddOperation extends AgentMemoryOperationBase {
	/** Facts extracted for this add() invocation. */
	extracted: Store<ExtractedFact[]>;
	/** Memory IDs touched by this add() (new or dedup-updated). */
	storedIds: Store<string[]>;
}

/** Operation handle returned by search(). */
export interface AgentMemorySearchOperation extends AgentMemoryOperationBase {
	/** Search results for this search() invocation only. */
	results: Store<AgentMemorySearchResult[]>;
}

export interface AgentMemoryResult {
	/**
	 * Pass conversation messages to the LLM for automatic fact extraction.
	 * Extracted facts are embedded, deduped, and stored.
	 */
	add(
		messages: Array<{ role: string; content: string }>,
		scope?: AgentMemoryScope,
		opts?: AgentMemoryAddOptions,
	): AgentMemoryAddOperation;

	/**
	 * Semantic search across all memories in scope.
	 * Updates the `results` store reactively.
	 */
	search(
		query: string,
		scope?: AgentMemoryScope,
		k?: number,
		opts?: AgentMemorySearchOptions,
	): AgentMemorySearchOperation;

	/** Get all memories in scope (snapshot). */
	getAll(scope?: AgentMemoryScope): MemoryNode<string>[];

	/** Update a specific memory's content. Re-embeds automatically. */
	update(id: string, content: string): void;

	/** Delete a specific memory. Returns true if found. */
	delete(id: string): boolean;

	/** Reactive memory count. */
	size: Store<number>;

	/** Expert access to internal callbag primitives (per §1.14). */
	inner: {
		/** The underlying collection (for advanced queries: topK, byTag, gc, etc.). */
		collection: Collection<string>;
		/** The underlying vector index (for advanced vector operations). */
		vectorIndex: VectorIndex;
		/** Extraction job queue (SA-4a). */
		extractionQueue: JobQueue<ExtractionJob, ExtractionResult>;
		/** Embedding job queue (SA-4b). */
		embeddingQueue: JobQueue<EmbedJob, EmbedResult>;
		/** Memory event topic (SA-4c). */
		events: Topic<MemoryEvent>;
		/** Graph extraction queue — present when knowledgeGraph option is set (SA-4d). */
		graphQueue?: JobQueue<GraphExtractionJob, GraphExtractionResult>;
		/** Shared-memory event bridge — present when `shared` option is provided (SA-4e). */
		sharedBridge?: TopicBridgeResult;
	};

	/** Tear down all internal state. */
	destroy(): void;
}
