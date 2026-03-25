// ---------------------------------------------------------------------------
// taskState — reactive task execution tracker
// ---------------------------------------------------------------------------
// Wraps any sync/async function with automatic status, duration, and error
// tracking. Each metadata field is an individual companion Store, independently
// subscribable. Aligns with the with*() companion store pattern (§20).
//
// Usage:
//   const task = taskState<Result>();
//   task.run((signal) => fetchData({ signal }));
//   // subscribe to task.status for completion
//   task.status.get()   // 'success'
//   task.duration.get() // ms
//   task.get()          // { status, result, error, ... } convenience
//
// Compose with fromCron + effect for scheduled tasks:
//   const cron = fromCron('0 9 * * *');
//   effect([cron], () => { task.run((signal) => fetchData({ signal })); });
// ---------------------------------------------------------------------------

import { batch, teardown } from "../core/protocol";
import { state } from "../core/state";
import type { WritableStore } from "../core/types";
import { rawFromPromise } from "../raw/fromPromise";
import { fromTimer } from "../raw/fromTimer";
import { rawRace } from "../raw/race";
import type { CallbagSource } from "../raw/subscribe";
import { rawSubscribe } from "../raw/subscribe";
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

/**
 * Creates a reactive task execution tracker with automatic status, duration, and error tracking.
 *
 * @param opts - Optional configuration.
 *
 * @returns `TaskState<T>` — a task tracker with the following API:
 *
 * @returnsTable run(fn) | (fn: (signal: AbortSignal) => T \| Promise<T>) => void | Execute a function with lifecycle tracking. Results tracked via stores.
 * get() | () => TaskMeta<T> | Returns the current metadata snapshot (status, result, error, duration, runCount).
 * status | Store<TaskStatus> | Reactive store: 'idle' \| 'running' \| 'success' \| 'error'.
 * result | Store<T \| undefined> | Reactive store of the last successful result.
 * error | Store<unknown \| undefined> | Reactive store of the last error.
 * duration | Store<number \| undefined> | Reactive store of the last run duration in ms.
 * runCount | Store<number> | Reactive store of total run count.
 * reset() | () => void | Reset to idle state and abort any running task.
 * destroy() | () => void | Tear down all reactive stores.
 *
 * @remarks **Signal-first:** The `run()` callback receives an `AbortSignal` as its first argument for cooperative cancellation.
 * @remarks **Companion stores:** Each metadata field is an individual reactive store, independently subscribable.
 * @remarks **Generation tracking:** Concurrent `reset()` during a `run()` silently discards the stale result.
 *
 * @example
 * ```ts
 * import { taskState } from 'callbag-recharge';
 *
 * const task = taskState<string>();
 * task.run((signal) => fetch('/api', { signal }).then(r => r.text()));
 * // subscribe to task.status for reactive completion notification
 * task.status.get(); // 'success' (after completion)
 * task.duration.get(); // e.g. 120
 * ```
 *
 * @seeAlso [track](./track) — lifecycle tracking, [pipeline](./pipeline) — workflow builder
 *
 * @category orchestrate
 */
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
	let abortController: AbortController | null = null;

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

		run(fn: (signal: AbortSignal) => T | Promise<T>, runOpts?: { timeout?: number }): void {
			if (destroyed) throw new Error("TaskState is destroyed");
			if (_status.get() === "running") throw new Error("Task is already running");

			const gen = generation;
			abortController = new AbortController();
			const signal = abortController.signal;
			const startTime = Date.now();
			const prevResult = _result.get();
			const prevRunCount = _runCount.get();
			batch(() => {
				_status.set("running");
				_error.set(undefined);
			});

			// Call user fn — may throw synchronously
			let callResult: T | Promise<T>;
			try {
				callResult = fn(signal);
			} catch (e) {
				// P4: If destroyed or reset() was called, discard
				if (destroyed || gen !== generation) return;
				abortController = null;
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
				return;
			}

			// Wrap result as a callbag source. Use rawFromPromise for PromiseLike,
			// otherwise emit the value directly. Do NOT use rawFromAny here because
			// it treats arrays/iterables as multi-value streams, but taskState.run()
			// expects a single result value.
			const isPromiseLike = callResult != null && typeof (callResult as any).then === "function";
			let source: CallbagSource = isPromiseLike
				? rawFromPromise(callResult as PromiseLike<T>)
				: (((type: number, sink?: any) => {
						if (type !== 0) return;
						let cancelled = false;
						sink(0, (t: number) => {
							if (t === 2) cancelled = true;
						});
						if (!cancelled) sink(1, callResult);
						if (!cancelled) sink(2);
					}) as CallbagSource);

			// Apply timeout via rawRace if configured
			if (runOpts?.timeout !== undefined) {
				const timeoutSource: CallbagSource = (type: number, sink?: any) => {
					if (type !== 0) return;
					const sub = rawSubscribe(fromTimer(runOpts.timeout!, signal), () => {
						sink(2 /* END */, new Error(`Timeout: ${runOpts.timeout}ms`));
					});
					sink(0 /* START */, (t: number) => {
						if (t === 2) sub.unsubscribe();
					});
				};
				source = rawRace(source, timeoutSource);
			}

			rawSubscribe(
				source,
				(result: T) => {
					// P4: If destroyed or reset() was called during async, discard
					if (destroyed || gen !== generation) return;
					abortController = null;
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
				},
				{
					onEnd: (err?: unknown) => {
						if (err === undefined) return; // Normal completion
						// P4: If destroyed or reset() was called during async, discard
						if (destroyed || gen !== generation) return;
						abortController = null;
						const duration = Date.now() - startTime;
						batch(() => {
							_status.set("error");
							_result.set(prevResult);
							_error.set(err);
							_lastRun.set(startTime);
							_duration.set(duration);
							_runCount.set(prevRunCount + 1);
							_version.update((v) => v + 1);
						});
					},
				},
			);
		},

		markSkipped() {
			if (destroyed) return;
			batch(() => {
				_status.set("skipped");
				_error.set(undefined);
			});
		},

		reset() {
			if (destroyed) return;
			if (abortController) {
				abortController.abort();
				abortController = null;
			}
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
			if (abortController) {
				abortController.abort();
				abortController = null;
			}
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
			if (abortController) {
				abortController.abort();
				abortController = null;
			}
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
