// ---------------------------------------------------------------------------
// AI surface layer — Tier 5
// ---------------------------------------------------------------------------
// Composed AI/LLM primitives for application development.
// H2 and user AI apps import from this layer — never from raw/, core/, extra/, utils/ directly.
//
// Includes:
//   - chatStream      — LLM streaming chat with backpressure
//   - agentLoop       — Observe → Plan → Act reactive agent cycle
//   - toolCallState   — reactive state machine for tool call lifecycle
//   - toolRegistry    — reactive tool dispatch with optional job queue backing
//   - memoryStore     — three-tier AI/LLM memory management
//   - hybridRoute     — confidence-based local/cloud LLM routing
//   - fromLLM         — unified reactive source for LLM inference
//   - checkpoint      — durable step boundary (re-exported from utils)
//   - indexedDBAdapter— IndexedDB checkpoint adapter (re-exported from utils)
//   - agentMemory     — Mem0-equivalent reactive agentic memory
//   - tokenTracker    — token/cost tracking operator (re-exported from utils)
// ---------------------------------------------------------------------------

// Re-exports from utils
export type {
	CheckpointAdapter,
	CheckpointedStore,
	CheckpointMeta,
} from "../utils/checkpoint";
export { checkpoint, memoryAdapter } from "../utils/checkpoint";
export type { IndexedDBAdapterOptions } from "../utils/checkpointAdapters";
export { indexedDBAdapter } from "../utils/checkpointAdapters";
export type { TokenMeta, TokenTrackedStore, TokenUsage } from "../utils/tokenTracker";
export { tokenTracker } from "../utils/tokenTracker";
export type {
	AgentLoopEntry,
	AgentLoopOptions,
	AgentLoopResult,
	AgentLoopResultBase,
	AgentPhase,
	GatedAgentLoopResult,
} from "./agentLoop";
export { agentLoop } from "./agentLoop";
export { agentMemory } from "./agentMemory";
export type {
	AgentMemoryOptions,
	AgentMemoryResult,
	AgentMemoryScope,
	AgentMemorySearchResult,
	AgentMemoryStatus,
	EmbedFn,
	ExtractedFact,
} from "./agentMemory/types";
export type {
	ChatMessage,
	ChatStreamFactory,
	ChatStreamOptions,
	ChatStreamResult,
} from "./chatStream";
export { chatStream } from "./chatStream";
export type {
	ConversationSummaryOptions,
	ConversationSummaryStore,
} from "./conversationSummary";
export { conversationSummary } from "./conversationSummary";
export type {
	DocIndexOptions,
	DocIndexResult,
	SearchResult,
} from "./docIndex";
export { docIndex } from "./docIndex";
export type {
	EmbeddingIndexOptions,
	EmbeddingIndexResult,
	EmbeddingManifest,
	EmbeddingManifestEntry,
	ScoredDoc,
} from "./embeddingIndex";
export { embeddingIndex } from "./embeddingIndex";
export type {
	GenerateOptions,
	LLMMessage,
	LLMOptions,
	LLMStore,
	LLMTokenUsage,
} from "./fromLLM";
export { fromLLM } from "./fromLLM";
export type {
	HybridRouteOptions,
	HybridRouteResult,
	RouteTarget,
} from "./hybridRoute";
export { hybridRoute } from "./hybridRoute";
export type { MemoryStoreOptions, MemoryStoreResult } from "./memoryStore";
export { memoryStore } from "./memoryStore";
export type {
	RagDoc,
	RagPipelineOptions,
	RagPipelineResult,
} from "./ragPipeline";
export { ragPipeline } from "./ragPipeline";
export type {
	PromptSection,
	SystemPromptBuilderOptions,
	SystemPromptBuilderStore,
} from "./systemPromptBuilder";
export { systemPromptBuilder } from "./systemPromptBuilder";
export type {
	ToolCallEntry,
	ToolCallStateOptions,
	ToolCallStateResult,
	ToolCallStatus,
} from "./toolCallState";
export { toolCallState } from "./toolCallState";
export type {
	ToolCallRequest,
	ToolDefinition,
	ToolRegistryOptions,
	ToolRegistryResult,
	ToolResult,
	ToolSchema,
} from "./toolRegistry";
export { toolRegistry } from "./toolRegistry";
