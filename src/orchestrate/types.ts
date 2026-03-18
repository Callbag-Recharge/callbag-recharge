// ---------------------------------------------------------------------------
// Orchestrate module types — Level 3E scheduling primitives
// ---------------------------------------------------------------------------

import type { NodeV0 } from "../data/types";

// ---------------------------------------------------------------------------
// TaskState
// ---------------------------------------------------------------------------

export type TaskStatus = "idle" | "running" | "success" | "error";

export interface TaskMeta<T = unknown> {
	status: TaskStatus;
	result?: T;
	error?: unknown;
	/** Timestamp (ms since epoch) of last run start. */
	lastRun?: number;
	/** Duration of last run in ms. */
	duration?: number;
	/** Total number of completed runs (success + error). */
	runCount: number;
}

export interface TaskState<T = unknown> extends NodeV0 {
	/** Current task metadata. */
	get(): TaskMeta<T>;
	/** Reactive source (callbag protocol). */
	source: (type: number, payload?: any) => void;

	/**
	 * Execute fn, tracking status/duration/error automatically.
	 * Transitions: idle/success/error → running → success/error.
	 * Throws if task is already running or destroyed.
	 */
	run(fn: () => T | Promise<T>): Promise<T>;

	/** Reset to idle state (clears result, error, timing). */
	reset(): void;

	/** Return a JSON-serializable snapshot. */
	snapshot(): TaskStateSnapshot<T>;

	/** Tear down internal stores. */
	destroy(): void;
}

export interface TaskStateSnapshot<T = unknown> extends NodeV0 {
	type: "taskState";
	meta: TaskMeta<T>;
}
