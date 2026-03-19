// ---------------------------------------------------------------------------
// Orchestrate module — Level 3E scheduling + workflow primitives
// ---------------------------------------------------------------------------

// Phase 2: Checkpoint
export type {
	CheckpointAdapter,
	CheckpointedStore,
	CheckpointMeta,
} from "./checkpoint";
export { checkpoint, memoryAdapter } from "./checkpoint";
export type {
	FileAdapterOptions,
	IndexedDBAdapterOptions,
	SQLiteAdapterOptions,
	SQLiteDatabase,
} from "./checkpointAdapters";
export { fileAdapter, indexedDBAdapter, sqliteAdapter } from "./checkpointAdapters";
export type { CronSchedule } from "./cron";
// Internal — exported for advanced users / testing
export { matchesCron, parseCron } from "./cron";
// Types
export type { DagNode, DagResult } from "./dag";
export { dag } from "./dag";
export type {
	ExecutionEntry,
	ExecutionEventType,
	ExecutionLogOptions,
	ExecutionLogPersistAdapter,
	ExecutionLogResult,
} from "./executionLog";
export { executionLog, memoryLogAdapter } from "./executionLog";
export type { FromCronOptions } from "./fromCron";
export { fromCron } from "./fromCron";
// Phase 1: Orchestration Operators
export type { TriggerStore } from "./fromTrigger";
export { fromTrigger } from "./fromTrigger";
export type { GatedStore, GateOptions } from "./gate";
export { gate } from "./gate";
// Phase 2: Pipeline
export type {
	PipelineResult,
	PipelineStatus,
	StepDef,
	StepMeta,
} from "./pipeline";
export { pipeline, step } from "./pipeline";
export { route } from "./route";
export { taskState } from "./taskState";
export type { TrackedStore, TrackMeta, TrackStatus } from "./track";
export { track } from "./track";
export type {
	TaskMeta,
	TaskState,
	TaskStateSnapshot,
	TaskStatus,
} from "./types";
export type { BreakerLike, WithBreakerOptions } from "./withBreaker";
export { CircuitOpenError, withBreaker } from "./withBreaker";
export type { DelayStrategy, RetryMeta, WithRetryOptions } from "./withRetry";
export { withRetry } from "./withRetry";
export { TimeoutError, withTimeout } from "./withTimeout";
