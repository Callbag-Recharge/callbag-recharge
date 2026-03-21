// ---------------------------------------------------------------------------
// sensor — Airflow sensor pattern pipeline step (Phase 5b-10)
// ---------------------------------------------------------------------------
// Poll an external condition at intervals until true, then forward the
// upstream value. The Airflow equivalent of "poke until ready".
//
// Usage:
//   const wf = pipeline({
//     trigger: step(fromTrigger<string>()),
//     ready:   sensor("trigger", async (v) => checkReady(v), { interval: 3000 }),
//     process: task(["ready"], async (v) => handle(v)),
//   });
// ---------------------------------------------------------------------------

import { pipe } from "../core/pipe";
import { producer } from "../core/producer";
import type { Store } from "../core/types";
import { switchMap } from "../extra/switchMap";
import type { StepDef } from "./pipeline";
import { taskState } from "./taskState";
import type { TaskState } from "./types";
import { TASK_STATE } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SensorOpts {
	/** Debug name for Inspector. */
	name?: string;
	/** Polling interval in milliseconds. Default: 5000. */
	interval?: number;
	/** Maximum time to wait before erroring, in milliseconds. No default (waits forever). */
	timeout?: number;
}

/** Extended StepDef that carries task metadata as flat companion stores. */
export interface SensorStepDef<T = any> extends StepDef<T | null> {
	/** Reactive task status: idle → running → success/error. */
	readonly status: Store<import("./types").TaskStatus>;
	/** Last error, if any. */
	readonly error: Store<unknown | undefined>;
	/** Duration of last run in ms. */
	readonly duration: Store<number | undefined>;
	/** Total number of completed runs. */
	readonly runCount: Store<number>;
	/** @internal Kind discriminator for diagram detection. */
	readonly _kind: "sensor";
	/** @internal Pipeline auto-detection symbol. */
	readonly [TASK_STATE]: TaskState<T>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a sensor step that polls an external condition until it returns true,
 * then forwards the upstream value. Implements the Airflow sensor pattern.
 *
 * @param dep - Name of the upstream step.
 * @param poll - Function receiving `(signal, value)`. Signal is aborted on reset/destroy. Returns true when the condition is met. May be async.
 * @param opts - Optional configuration (interval, timeout, name).
 *
 * @returns `SensorStepDef<T>` — step definition for pipeline() with task tracking.
 *
 * @remarks **Polling:** Calls `poll(value)` every `interval` ms (default 5000). Stops on first truthy return.
 * @remarks **Timeout:** If `timeout` is set and the condition is not met within that time, the task errors.
 * @remarks **Re-trigger:** New upstream values cancel the current polling loop (switchMap semantics).
 * @remarks **Passthrough:** On success, emits the upstream value (not the poll result).
 *
 * @example
 * ```ts
 * import { pipeline, step, task, sensor, fromTrigger } from 'callbag-recharge/orchestrate';
 *
 * // Poll every 3s until file is ready, then process
 * const wf = pipeline({
 *   trigger: step(fromTrigger<string>()),
 *   ready:   sensor("trigger", async (path) => {
 *     const res = await fetch(`/api/status/${path}`);
 *     return (await res.json()).ready;
 *   }, { interval: 3000, timeout: 60000 }),
 *   process: task(["ready"], async (path) => handle(path)),
 * });
 * ```
 *
 * @category orchestrate
 */
export function sensor<T>(
	dep: string,
	poll: (signal: AbortSignal, value: T) => boolean | Promise<boolean>,
	opts?: SensorOpts,
): SensorStepDef<T> {
	const interval = opts?.interval ?? 5000;
	const timeout = opts?.timeout;
	const ts = taskState<T>({ id: opts?.name });

	const factory = (depStore: Store<T>): Store<T | null> => {
		return pipe(
			depStore,
			switchMap((value: T) => {
				// Undefined guard
				if (value === undefined) {
					return producer<T | null>(({ emit, complete }) => {
						emit(null);
						complete();
						return undefined;
					});
				}

				ts.restart();

				return producer<T | null>(({ emit, complete }) => {
					let stopped = false;
					let emitted = false;
					let polling = false;
					let pollTimer: ReturnType<typeof setInterval> | null = null;
					let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
					let pendingReject: ((reason: unknown) => void) | undefined;

					const clearTimers = () => {
						if (pollTimer !== null) {
							clearInterval(pollTimer);
							pollTimer = null;
						}
						if (timeoutTimer !== null) {
							clearTimeout(timeoutTimer);
							timeoutTimer = null;
						}
					};

					const cleanup = () => {
						stopped = true;
						clearTimers();
						if (pendingReject) {
							pendingReject(new Error("sensor: cancelled"));
							pendingReject = undefined;
						}
					};

					const safeEmit = (v: T | null) => {
						if (!stopped && !emitted) {
							emitted = true;
							emit(v);
						}
					};
					const safeComplete = () => {
						if (!stopped) complete();
					};

					ts.run(async (signal) => {
						// Check immediately before starting interval
						const firstCheck = await poll(signal, value);
						if (stopped) throw new Error("sensor: cancelled");
						if (firstCheck) {
							safeEmit(value);
							safeComplete();
							return value;
						}

						// Set up timeout if configured
						return new Promise<T>((resolve, reject) => {
							pendingReject = reject;

							if (stopped) {
								pendingReject = undefined;
								reject(new Error("sensor: cancelled"));
								return;
							}

							if (timeout !== undefined) {
								timeoutTimer = setTimeout(() => {
									timeoutTimer = null;
									clearTimers();
									pendingReject = undefined;
									reject(new Error(`sensor: timed out after ${timeout}ms`));
								}, timeout);
							}

							pollTimer = setInterval(() => {
								if (stopped || polling) return;
								polling = true;

								Promise.resolve(poll(signal, value))
									.then((result) => {
										polling = false;
										if (stopped) return;
										if (result) {
											clearTimers();
											pendingReject = undefined;
											safeEmit(value);
											safeComplete();
											stopped = true;
											resolve(value);
										}
									})
									.catch((err) => {
										polling = false;
										if (stopped) return;
										clearTimers();
										pendingReject = undefined;
										reject(err);
									});
							}, interval);
						});
					}).catch(() => {
						// Error tracked by taskState
						if (!stopped) {
							safeEmit(null);
							safeComplete();
						}
					});

					return cleanup;
				});
			}),
		) as Store<T | null>;
	};

	const def: SensorStepDef<T> = {
		factory: factory as any,
		deps: [dep],
		name: opts?.name,
		_kind: "sensor",
		status: ts.status,
		error: ts.error,
		duration: ts.duration,
		runCount: ts.runCount,
		[TASK_STATE]: ts,
	};

	return def;
}
