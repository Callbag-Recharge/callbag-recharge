// ---------------------------------------------------------------------------
// Orchestrate module — workflow nodes + orchestration-specific plumbing
// ---------------------------------------------------------------------------
// Workflow nodes: pipeline, step, task, branch, approval
// Orchestration plumbing: taskState, executionLog, gate (internal, wrapped by approval)
//
// Generic operators/sources live in their natural homes:
//   extra/ — fromTrigger, fromCron, cron, route, timeout
//   utils/ — track, checkpoint, tokenTracker, withBreaker, dag, retry
// ---------------------------------------------------------------------------

// -- Workflow nodes ----------------------------------------------------------
export type { ApprovalOpts, ApprovalStepDef } from "./approval";
export { approval } from "./approval";
export type { BranchStepDef } from "./branch";
export { branch } from "./branch";
// -- Orchestration plumbing --------------------------------------------------
export type {
	ExecutionEntry,
	ExecutionEventType,
	ExecutionLogOptions,
	ExecutionLogPersistAdapter,
	ExecutionLogResult,
} from "./executionLog";
export { executionLog, memoryLogAdapter } from "./executionLog";
export type {
	FileLogAdapterOptions,
	IndexedDBLogAdapterOptions,
	SQLiteDatabase as SQLiteLogDatabase,
	SQLiteLogAdapterOptions,
} from "./executionLogAdapters";
export { fileLogAdapter, indexedDBLogAdapter, sqliteLogAdapter } from "./executionLogAdapters";
export type { ForEachOpts, ForEachStepDef } from "./forEach";
export { forEach } from "./forEach";
export type { GatedStore, GateOptions } from "./gate";
export { gate } from "./gate";
export type { OnFailureOpts, OnFailureStepDef } from "./onFailure";
export { onFailure } from "./onFailure";
export type {
	PipelineInner,
	PipelineResult,
	PipelineStatus,
	StepDef,
	StepMeta,
} from "./pipeline";
export { pipeline, step } from "./pipeline";
export type { SubPipelineDef, SubPipelineOpts, SubPipelineStepDef } from "./subPipeline";
export { subPipeline } from "./subPipeline";
export type { TaskOpts, TaskStepDef } from "./task";
export { task } from "./task";
export { taskState } from "./taskState";
export type {
	TaskMeta,
	TaskState,
	TaskStateSnapshot,
	TaskStatus,
} from "./types";
export type { WaitOpts } from "./wait";
export { wait } from "./wait";
