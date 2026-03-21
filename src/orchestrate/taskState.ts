// ---------------------------------------------------------------------------
// taskState — reactive task execution tracker
// ---------------------------------------------------------------------------
// Wraps any sync/async function with automatic status, duration, and error
// tracking. Built on state() — subscribers get TaskMeta updates reactively.
//
// Usage:
//   const task = taskState<Result>();
//   await task.run(() => fetchData());
//   task.get().status  // 'success'
//   task.get().duration // ms
//
// Compose with fromCron + effect for scheduled tasks:
//   const cron = fromCron('0 9 * * *');
//   effect([cron], () => { task.run(() => fetchData()); });
// ---------------------------------------------------------------------------

import { batch, teardown } from "../core/protocol";
import { state } from "../core/state";
import type { WritableStore } from "../core/types";
import type { TaskMeta, TaskState, TaskStateSnapshot } from "./types";

let taskCounter = 0;

// P1: Frozen to prevent mutation of shared singleton
const IDLE_META: TaskMeta = Object.freeze({ status: "idle", runCount: 0 }) as TaskMeta;

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
	const _state: WritableStore<TaskMeta<T>> = state<TaskMeta<T>>({ ...IDLE_META } as TaskMeta<T>, {
		name: nodeId,
		equals: () => false, // always emit on transition
	});
	const _version = state<number>(0, { name: `${nodeId}:ver` });
	let destroyed = false;
	// P4: Generation counter — incremented by reset(). run() captures at start;
	// if it changes during await, the completion is silently discarded.
	let generation = 0;

	const self: TaskState<T> & { _restore(meta: TaskMeta<T>): void } = {
		// P5: Type-safe restore for from() — not exposed on TaskState interface
		_restore(meta: TaskMeta<T>) {
			_state.set(meta);
		},

		get id() {
			return nodeId;
		},
		get version() {
			return _version.get();
		},

		get() {
			return _state.get();
		},
		inner: _state,

		async run(fn: () => T | Promise<T>): Promise<T> {
			if (destroyed) throw new Error("TaskState is destroyed");
			const prev = _state.get();
			if (prev.status === "running") throw new Error("Task is already running");

			const gen = generation;
			const startTime = Date.now();
			_state.set({ ...prev, status: "running", error: undefined });

			try {
				const result = await fn();
				// P4: If destroyed or reset() was called during await, discard
				if (destroyed || gen !== generation) return result;
				const duration = Date.now() - startTime;
				batch(() => {
					_state.set({
						status: "success",
						result,
						error: undefined,
						lastRun: startTime,
						duration,
						runCount: prev.runCount + 1,
					});
					_version.update((v) => v + 1);
				});
				return result;
			} catch (e) {
				// P4: If destroyed or reset() was called during await, discard
				if (destroyed || gen !== generation) throw e;
				const duration = Date.now() - startTime;
				batch(() => {
					_state.set({
						status: "error",
						result: prev.result,
						error: e,
						lastRun: startTime,
						duration,
						runCount: prev.runCount + 1,
					});
					_version.update((v) => v + 1);
				});
				throw e;
			}
		},

		reset() {
			if (destroyed) return;
			generation++;
			batch(() => {
				_state.set({ ...IDLE_META } as TaskMeta<T>);
				_version.update((v) => v + 1);
			});
		},

		snapshot(): TaskStateSnapshot<T> {
			return {
				type: "taskState",
				id: nodeId,
				version: _version.get(),
				meta: { ..._state.get() },
			};
		},

		destroy() {
			if (destroyed) return;
			destroyed = true;
			teardown(_state);
			teardown(_version);
		},
	};

	return self;
}
