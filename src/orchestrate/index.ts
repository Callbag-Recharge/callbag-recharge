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

export { effect } from "../core/effect";
// -- Re-exports from lower tiers (for orchestrate-level consumers) ----------
export { state } from "../core/state";
export type { Store, WritableStore } from "../core/types";
export type { TriggerStore } from "../extra/fromTrigger";
export { fromTrigger } from "../extra/fromTrigger";
// -- Workflow nodes ----------------------------------------------------------
export type { ApprovalOpts, ApprovalStepDef } from "./approval";
export { approval } from "./approval";
export type { BranchStepDef } from "./branch";
export { branch } from "./branch";
// -- DAG layout for visualization ------------------------------------------
export type { DagLayoutEdge, DagLayoutOpts, DagLayoutResult, LayoutNode } from "./dagLayout";
export { dagLayout } from "./dagLayout";
// -- Additional workflow nodes ------------------------------------------------
export type { D2Opts, MermaidOpts } from "./diagram";
export { toD2, toMermaid } from "./diagram";
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
	IndexedDBLogAdapterOptions,
	SQLiteDatabase as SQLiteLogDatabase,
	SQLiteLogAdapterOptions,
} from "./executionLogAdapters";
export { indexedDBLogAdapter, sqliteLogAdapter } from "./executionLogAdapters";
// Node-only: fileLogAdapter is in executionLogAdapters.node.ts (import from 'callbag-recharge/orchestrate/node')
export type { ForEachOpts, ForEachStepDef } from "./forEach";
export { forEach } from "./forEach";
export type { GateController, GatedStore, GateOptions } from "./gate";
export { gate } from "./gate";
export type {
	AppendStrategy,
	IntersectStrategy,
	JoinOpts,
	JoinStepDef,
	JoinStrategy,
	MergeStrategy,
} from "./join";
export { join } from "./join";
export type { LoopDef, LoopOpts, LoopStepDef } from "./loop";
export { loop } from "./loop";
export type { OnFailureOpts, OnFailureStepDef } from "./onFailure";
export { onFailure } from "./onFailure";
export type {
	PipelineInner,
	PipelineResult,
	PipelineStatus,
	StepDef,
	StepMeta,
} from "./pipeline";
export { pipeline, source, step } from "./pipeline";
export type {
	ManagedPipeline,
	PipelineRunnerConfig,
	PipelineRunnerResult,
	RunnerStatus,
} from "./pipelineRunner";
export { pipelineRunner } from "./pipelineRunner";
export type { SensorOpts, SensorStepDef } from "./sensor";
export { sensor } from "./sensor";
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
export { TASK_STATE } from "./types";
export type { WaitOpts } from "./wait";
export { wait } from "./wait";
// -- Workflow node (bundled task node with log + breaker) -------------------
export type { WorkflowNodeOpts, WorkflowNodeResult } from "./workflowNode";
export { workflowNode } from "./workflowNode";
