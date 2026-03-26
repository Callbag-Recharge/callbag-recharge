// Core type re-exports (so utils+ consumers don't need raw core imports)
export type { Store, WritableStore } from "../core/types";

// Auto-save (debounce + checkpoint + status)

// Async queue
export type { AsyncQueueOptions, AsyncQueueResult } from "./asyncQueue";
export { asyncQueue } from "./asyncQueue";
export type { AutoSaveOptions, AutoSaveResult } from "./autoSave";
export { autoSave } from "./autoSave";
// Backoff strategies
export type { BackoffPreset, BackoffStrategy, ExponentialOptions, JitterMode } from "./backoff";
export {
	constant,
	decorrelatedJitter,
	exponential,
	fibonacci,
	linear,
	resolveBackoffPreset,
	withMaxAttempts,
} from "./backoff";
// Batch writer
export type {
	BatchWriterOptions,
	BatchWriterResult,
} from "./batchWriter";
export { batchWriter } from "./batchWriter";
// Cancellable action
export type {
	ActionFn,
	CancellableActionOptions,
	CancellableActionResult,
} from "./cancellableAction";
export { cancellableAction } from "./cancellableAction";
// Cancellable stream
export type {
	CancellableStreamOptions,
	CancellableStreamResult,
	FromAbortableOptions,
	StreamFactory,
} from "./cancellableStream";
export { cancellableStream, fromAbortable } from "./cancellableStream";
// Cascading cache
export type {
	CacheTier,
	CascadingCache,
	CascadingCacheOptions,
} from "./cascadingCache";
export { cascadingCache } from "./cascadingCache";
// Checkpoint
export type {
	CheckpointAdapter,
	CheckpointedStore,
	CheckpointMeta,
} from "./checkpoint";
export { checkpoint, memoryAdapter } from "./checkpoint";
export type {
	IndexedDBAdapterOptions,
	SQLiteAdapterOptions,
	SQLiteDatabase,
} from "./checkpointAdapters";
export { indexedDBAdapter, sqliteAdapter } from "./checkpointAdapters";
// Node-only: fileAdapter is in checkpointAdapters.node.ts (import from 'callbag-recharge/utils/node')
// Circuit breaker
export type { CircuitBreaker, CircuitBreakerOptions, CircuitState } from "./circuitBreaker";
export { circuitBreaker } from "./circuitBreaker";
// Connection health
export type {
	ConnectionHealthOptions,
	ConnectionHealthResult,
	ConnectionStatus,
} from "./connectionHealth";
export { connectionHealth } from "./connectionHealth";
// Content stats (word/char/line count)
export type { ContentStats } from "./contentStats";
export { contentStats } from "./contentStats";
// Cursor info (line/column/display from content + position)
export type { CursorInfo } from "./cursorInfo";
export { cursorInfo } from "./cursorInfo";
// DAG
export type { DagNode, DagResult } from "./dag";
export { dag } from "./dag";
// Dirty tracker
export type { DirtyTrackerOptions, DirtyTrackerResult } from "./dirtyTracker";
export { dirtyTracker } from "./dirtyTracker";
export type { EvictionPolicy } from "./eviction";
export { fifo, lfu, lru, random, scored } from "./eviction";
// Keyed async dedup
export { keyedAsync } from "./keyedAsync";
// Rate limiter
export type {
	RateLimiter,
	SlidingWindowOptions,
	TokenBucketOptions,
} from "./rateLimiter";
export { slidingWindow, tokenBucket } from "./rateLimiter";
export { reactiveScored } from "./reactiveEviction";
// Retry
export type { DelayStrategy, RetryMeta, RetryOptions } from "./retry";
export { retry } from "./retry";
// State machine
export type {
	D2Opts as StateMachineD2Opts,
	MermaidOpts as StateMachineMermaidOpts,
	StateMachineConfig,
	StateMachineResult,
	StateNode,
	Transition,
	TransitionDef,
	TransitionEdge,
} from "./stateMachine";
export { stateMachine } from "./stateMachine";
// Tiered storage
export type {
	TieredStorageAdapter,
	TieredStorageOptions,
} from "./tieredStorage";
export { tieredStorage } from "./tieredStorage";
// Timer
export type {
	CountdownOptions,
	CountdownResult,
	StopwatchOptions,
	StopwatchResult,
} from "./timer";
export { countdown, stopwatch } from "./timer";
// Token tracker
export type { TokenMeta, TokenTrackedStore, TokenUsage } from "./tokenTracker";
export { tokenTracker } from "./tokenTracker";
// Track (stream metadata)
export type { TrackedStore, TrackMeta, TrackStatus } from "./track";
export { track } from "./track";
// Validation pipeline
export type {
	AsyncValidator,
	SyncValidator,
	ValidationPipelineOptions,
	ValidationPipelineResult,
} from "./validationPipeline";
export { validationPipeline } from "./validationPipeline";
// With breaker (circuit breaker operator)
export type { BreakerLike, WithBreakerOptions, WithBreakerStore } from "./withBreaker";
export { CircuitOpenError, withBreaker } from "./withBreaker";
// With connection status (connection lifecycle wrapper)
export type {
	ConnectionControl,
	ConnectionStatusValue,
	WithConnectionStatusOptions,
	WithConnectionStatusStore,
} from "./withConnectionStatus";
export { withConnectionStatus } from "./withConnectionStatus";
// With meta (reactive companion stores for protocol events)
export type { MetaResult } from "./withMeta";
export { withMeta } from "./withMeta";
// With status (async metadata wrapper)
export type { WithStatusOptions, WithStatusStatus, WithStatusStore } from "./withStatus";
export { withStatus } from "./withStatus";
