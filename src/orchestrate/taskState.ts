// ---------------------------------------------------------------------------
// taskState — reactive task execution tracker
// ---------------------------------------------------------------------------
// Wraps any sync/async function with automatic status, duration, and error
// tracking. Each metadata field is an individual companion Store, independently
// subscribable. Aligns with the with*() companion store pattern (§20).
//
// Usage:
//   const task = taskState<Result>();
//   await task.run(() => fetchData());
//   task.status.get()   // 'success'
//   task.duration.get() // ms
//   task.get()          // { status, result, error, ... } convenience
//
// Compose with fromCron + effect for scheduled tasks:
//   const cron = fromCron('0 9 * * *');
//   effect([cron], () => { task.run(() => fetchData()); });
// ---------------------------------------------------------------------------

import { batch, teardown } from "../core/protocol";
import { state } from "../core/state";
import type { WritableStore } from "../core/types";
import type { TaskMeta, TaskState, TaskStateSnapshot, TaskStatus } from "./types";

let taskCounter = 0;

/**
 * Restore a taskState from a snapshot. Preserves id; version resets to 0.
 */
taskState.from = function from<T>(snap: TaskStateSnapshot<T>): TaskState<T> {
	const task = taskState<T>({ id: snap.id }) as TaskState<T> & {
		_restore(meta: TaskMeta<T>): void;
	};
	// Restore the meta state (but status resets to idle — we can't resume a running task)
	if (snap.meta.runCount > 0) {
		task._restore({
			...snap.meta,
			status: snap.meta.status === "running" ? "error" : snap.meta.status,
			error:
				snap.meta.status === "running"
					? new Error("Interrupted: restored from snapshot")
					: snap.meta.error,
		});
	}
	return task;
};

export function taskState<T = unknown>(opts?: { id?: string }): TaskState<T> {
	const counter = ++taskCounter;
	const nodeId = opts?.id ?? `task-${counter}`;

	// Individual companion stores
	const _status: WritableStore<TaskStatus> = state<TaskStatus>("idle", {
		name: `${nodeId}:status`,
		equals: () => false, // always emit on transition
	});
	const _error: WritableStore<unknown | undefined> = state<unknown | undefined>(undefined, {
		name: `${nodeId}:error`,
	});
	const _duration: WritableStore<number | undefined> = state<number | undefined>(undefined, {
		name: `${nodeId}:duration`,
	});
	const _runCount: WritableStore<number> = state<number>(0, {
		name: `${nodeId}:runCount`,
	});
	const _result: WritableStore<T | undefined> = state<T | undefined>(undefined, {
		name: `${nodeId}:result`,
	});
	const _lastRun: WritableStore<number | undefined> = state<number | undefined>(undefined, {
		name: `${nodeId}:lastRun`,
	});
	const _version = state<number>(0, { name: `${nodeId}:ver` });

	let destroyed = false;
	// P4: Generation counter — incremented by reset(). run() captures at start;
	// if it changes during await, the completion is silently discarded.
	let generation = 0;

	const self: TaskState<T> & { _restore(meta: TaskMeta<T>): void } = {
		// P5: Type-safe restore for from() — not exposed on TaskState interface
		_restore(meta: TaskMeta<T>) {
			batch(() => {
				_status.set(meta.status);
				_error.set(meta.error);
				_duration.set(meta.duration);
				_runCount.set(meta.runCount);
				_result.set(meta.result);
				_lastRun.set(meta.lastRun);
			});
		},

		get id() {
			return nodeId;
		},
		get version() {
			return _version.get();
		},

		// Companion stores
		status: _status,
		error: _error,
		duration: _duration,
		runCount: _runCount,
		result: _result,
		lastRun: _lastRun,

		get(): TaskMeta<T> {
			return {
				status: _status.get(),
				result: _result.get(),
				error: _error.get(),
				lastRun: _lastRun.get(),
				duration: _duration.get(),
				runCount: _runCount.get(),
			};
		},

		async run(fn: () => T | Promise<T>): Promise<T> {
			if (destroyed) throw new Error("TaskState is destroyed");
			if (_status.get() === "running") throw new Error("Task is already running");

			const gen = generation;
			const startTime = Date.now();
			const prevResult = _result.get();
			const prevRunCount = _runCount.get();
			batch(() => {
				_status.set("running");
				_error.set(undefined);
			});

			try {
				const result = await fn();
				// P4: If destroyed or reset() was called during await, discard
				if (destroyed || gen !== generation) return result;
				const duration = Date.now() - startTime;
				batch(() => {
					_status.set("success");
					_result.set(result);
					_error.set(undefined);
					_lastRun.set(startTime);
					_duration.set(duration);
					_runCount.set(prevRunCount + 1);
					_version.update((v) => v + 1);
				});
				return result;
			} catch (e) {
				// P4: If destroyed or reset() was called during await, discard
				if (destroyed || gen !== generation) throw e;
				const duration = Date.now() - startTime;
				batch(() => {
					_status.set("error");
					_result.set(prevResult);
					_error.set(e);
					_lastRun.set(startTime);
					_duration.set(duration);
					_runCount.set(prevRunCount + 1);
					_version.update((v) => v + 1);
				});
				throw e;
			}
		},

		reset() {
			if (destroyed) return;
			generation++;
			batch(() => {
				_status.set("idle");
				_error.set(undefined);
				_duration.set(undefined);
				_runCount.set(0);
				_result.set(undefined);
				_lastRun.set(undefined);
				_version.update((v) => v + 1);
			});
		},

		restart() {
			if (destroyed) return;
			generation++;
			batch(() => {
				_status.set("idle");
				_error.set(undefined);
				_duration.set(undefined);
				// Preserve: runCount, result, lastRun
			});
		},

		snapshot(): TaskStateSnapshot<T> {
			return {
				type: "taskState",
				id: nodeId,
				version: _version.get(),
				meta: { ...self.get() },
			};
		},

		destroy() {
			if (destroyed) return;
			destroyed = true;
			teardown(_status);
			teardown(_error);
			teardown(_duration);
			teardown(_runCount);
			teardown(_result);
			teardown(_lastRun);
			teardown(_version);
		},
	};

	return self;
}
