// ---------------------------------------------------------------------------
// sensor — Airflow sensor pattern pipeline step (Phase 5b-10)
// ---------------------------------------------------------------------------
// Poll an external condition at intervals until true, then forward the
// upstream value. The Airflow equivalent of "poke until ready".
//
// Usage:
//   const wf = pipeline({
//     trigger: step(fromTrigger<string>()),
//     ready:   sensor("trigger", async (signal, v) => checkReady(v), { interval: 3000 }),
//     process: task(["ready"], async (signal, [v]) => handle(v)),
//   });
// ---------------------------------------------------------------------------

import { operator } from "../core/operator";
import { pipe } from "../core/pipe";
import { producer } from "../core/producer";
import { DATA, END, RESET, STATE, TEARDOWN, teardown } from "../core/protocol";
import { state } from "../core/state";
import type { Store } from "../core/types";
import { firstValueFrom } from "../extra/firstValueFrom";
import { interval } from "../extra/interval";
import { subscribe } from "../extra/subscribe";
import { switchMap } from "../extra/switchMap";
import { firstValueFrom as rawFirstValueFrom } from "../raw/firstValueFrom";
import { fromTimer } from "../raw/fromTimer";
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
export interface SensorStepDef<T = any> extends StepDef<T | undefined> {
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
 * @remarks **Timeout:** If `timeout` is set and the condition is not met within that time, the task errors and emits `undefined`.
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
 *   ready:   sensor("trigger", async (signal, path) => {
 *     const res = await fetch(`/api/status/${path}`);
 *     return (await res.json()).ready;
 *   }, { interval: 3000, timeout: 60000 }),
 *   process: task(["ready"], async (signal, [path]) => handle(path)),
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
	const pollInterval = opts?.interval ?? 5000;
	const timeout = opts?.timeout;
	const ts = taskState<T>({ id: opts?.name });

	const factory = (depStore: Store<T>): Store<T | undefined> => {
		const switched = pipe(
			depStore,
			switchMap((value: T) => {
				// Undefined guard: don't emit, just complete so switchMap waits
				if (value === undefined) {
					return producer<T | undefined>(({ complete }) => {
						complete();
						return undefined;
					});
				}

				ts.restart();

				return producer<T | undefined>(({ emit, complete }) => {
					let stopped = false;
					let emitted = false;
					let polling = false;
					let tickSub: { unsubscribe(): void } | null = null;
					let doneStore: Store<any> | null = null;

					const cleanup = () => {
						stopped = true;
						tickSub?.unsubscribe();
						tickSub = null;
						if (doneStore) {
							teardown(doneStore);
							doneStore = null;
						}
					};

					const safeEmit = (v: T | undefined) => {
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

						if (stopped) throw new Error("sensor: cancelled");

						// Poll on interval, signal result via state store
						const done$ = state<{ ok: boolean; err?: unknown } | null>(null);
						doneStore = done$;
						const tick$ = interval(pollInterval);

						tickSub = subscribe(tick$, () => {
							if (stopped || polling) return;
							polling = true;

							Promise.resolve(poll(signal, value))
								.then((result) => {
									polling = false;
									if (stopped) return;
									if (result) {
										tickSub?.unsubscribe();
										tickSub = null;
										done$.set({ ok: true });
									}
								})
								.catch((err) => {
									polling = false;
									if (stopped) return;
									tickSub?.unsubscribe();
									tickSub = null;
									done$.set({ ok: false, err });
								});
						});

						// Race: poll success vs timeout
						const waitForPoll = firstValueFrom<{ ok: boolean; err?: unknown } | null>(
							done$,
							(v) => v !== null,
						);

						let timedOut = false;
						let result: { ok: boolean; err?: unknown } | null;
						if (timeout !== undefined) {
							const timeoutRace = rawFirstValueFrom(fromTimer(timeout, signal)).then((): null => {
								timedOut = true;
								return null;
							});
							result = await Promise.race([waitForPoll, timeoutRace]);
						} else {
							result = await waitForPoll;
						}

						// Clean up done$ store
						teardown(done$);

						if (timedOut) {
							throw new Error(`sensor: timed out after ${timeout}ms`);
						}

						if (result && !result.ok) {
							throw result.err;
						}

						safeEmit(value);
						safeComplete();
						return value;
					}).catch(() => {
						// Error tracked by taskState
						if (!stopped) {
							safeEmit(undefined);
							safeComplete();
						}
					});

					return cleanup;
				});
			}),
		) as Store<T | undefined>;

		return operator<T | undefined>(
			[switched] as Store<unknown>[],
			({ emit, signal, complete, error: actionsError }) => {
				return (_dep, type, data) => {
					if (type === STATE) {
						if (data === RESET) {
							ts.restart();
							return;
						}
						if (data === TEARDOWN) {
							ts.destroy();
							return;
						}
						signal(data);
					} else if (type === DATA) {
						emit(data as T | undefined);
					} else if (type === END) {
						data !== undefined ? actionsError(data) : complete();
					}
				};
			},
			{ kind: "sensor", name: opts?.name },
		) as Store<T | undefined>;
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
