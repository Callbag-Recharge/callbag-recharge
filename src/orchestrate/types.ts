// ---------------------------------------------------------------------------
// Orchestrate module types — Level 3E scheduling primitives
// ---------------------------------------------------------------------------

import type { Store } from "../core/types";
import type { NodeV0 } from "../data/types";

// ---------------------------------------------------------------------------
// TaskState
// ---------------------------------------------------------------------------

/** @internal Symbol key for pipeline auto-detection of task state. */
export const TASK_STATE: unique symbol = Symbol.for("callbag-recharge:taskState");

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
	/** Reactive task status: idle → running → success/error. */
	status: Store<TaskStatus>;
	/** Last error, if any. Reset to undefined on new run or reset. */
	error: Store<unknown | undefined>;
	/** Duration of last run in ms. */
	duration: Store<number | undefined>;
	/** Total number of completed runs (success + error). */
	runCount: Store<number>;
	/** Last run result. */
	result: Store<T | undefined>;
	/** Timestamp (ms since epoch) of last run start. */
	lastRun: Store<number | undefined>;

	/** Read all metadata at once (convenience). */
	get(): TaskMeta<T>;

	/**
	 * Execute fn, tracking status/duration/error automatically.
	 * Transitions: idle/success/error → running → success/error.
	 * Throws if task is already running or destroyed.
	 *
	 * The fn receives an AbortSignal that is aborted on reset(), restart(),
	 * or destroy(). Users can forward it to fetch(), etc. for cancellation.
	 */
	run(fn: (signal: AbortSignal) => T | Promise<T>): Promise<T>;

	/** Reset to idle state (clears result, error, timing, runCount). */
	reset(): void;

	/**
	 * Lightweight re-trigger reset. Bumps generation (discards in-flight run),
	 * resets status/error/duration to idle, but preserves runCount, result, lastRun.
	 * Used by switchMap re-trigger paths in task()/forEach().
	 */
	restart(): void;

	/** Return a JSON-serializable snapshot. */
	snapshot(): TaskStateSnapshot<T>;

	/** Tear down internal stores. */
	destroy(): void;
}

export interface TaskStateSnapshot<T = unknown> extends NodeV0 {
	type: "taskState";
	meta: TaskMeta<T>;
}
