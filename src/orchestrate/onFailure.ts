// ---------------------------------------------------------------------------
// onFailure — dead letter / error routing pipeline step (Phase 5b-4)
// ---------------------------------------------------------------------------
// Routes terminal task failures to a handler step. Activates when the dep
// step's taskState error transitions from undefined → error (i.e. after
// retries exhausted). Classic dead letter queue pattern.
//
// Usage:
//   const wf = pipeline({
//     trigger: step(fromTrigger<string>()),
//     fetch:   task(["trigger"], async (signal, [v]) => fetchData(v), { retry: 3 }),
//     dlq:     onFailure("fetch", async (signal, err) => logToDeadLetter(err)),
//   });
// ---------------------------------------------------------------------------

import { operator } from "../core/operator";
import { pipe } from "../core/pipe";
import { producer } from "../core/producer";
import { DATA, END, RESET, STATE, type Subscription, TEARDOWN } from "../core/protocol";
import type { Store } from "../core/types";
import { subscribe } from "../extra/subscribe";
import { switchMap } from "../extra/switchMap";
import type { StepDef } from "./pipeline";
import { taskState } from "./taskState";
import type { TaskState } from "./types";
import { TASK_STATE } from "./types";

/** @internal Symbol key for pipeline to identify error handler steps (excluded from skip propagation). */
export const ON_FAILURE_ROLE: unique symbol = Symbol.for("callbag-recharge:onFailureRole");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OnFailureOpts {
	/** Debug name for Inspector. */
	name?: string;
}

/** Extended StepDef that carries task metadata as flat companion stores. */
export interface OnFailureStepDef<T = any> extends StepDef<T | undefined> {
	/** Reactive task status: idle → running → success/error. */
	readonly status: Store<import("./types").TaskStatus>;
	/** Last error from the handler itself (not the upstream error). */
	readonly error: Store<unknown | undefined>;
	/** Duration of last handler run in ms. */
	readonly duration: Store<number | undefined>;
	/** Total number of completed handler runs. */
	readonly runCount: Store<number>;
	/** @internal Pipeline auto-detection symbol. */
	readonly [TASK_STATE]: TaskState<T>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a dead letter / error routing step. Activates when the upstream
 * task's error companion store emits a non-undefined value (terminal failure
 * after retries exhausted).
 *
 * Pipeline auto-registers `"stepName.error"` for any `task()` step, so
 * `onFailure` resolves its dep to the task's error companion store.
 *
 * @param dep - Name of the upstream task step to watch for failures.
 * @param handler - Function receiving `(signal, error)`. Signal is aborted on reset/destroy. Returns a value for downstream steps.
 * @param opts - Optional configuration (name).
 *
 * @returns `OnFailureStepDef<T>` — step definition for pipeline() with task tracking.
 *
 * @remarks **Activation:** Only fires when the dep step errors (error store transitions to non-undefined).
 * @remarks **Re-trigger:** If the dep step errors again (after reset + re-run), the handler re-fires (switchMap cancels any in-flight handler).
 * @remarks **Task tracking:** Internal `taskState` tracks handler execution. Pipeline auto-detects it for aggregate status.
 *
 * @example
 * ```ts
 * import { pipeline, step, task, onFailure, fromTrigger } from 'callbag-recharge/orchestrate';
 *
 * const wf = pipeline({
 *   trigger: step(fromTrigger<string>()),
 *   fetch:   task(["trigger"], async (signal, [v]) => fetchData(v), { retry: 3 }),
 *   dlq:     onFailure("fetch", async (signal, error) => {
 *     await logToDeadLetterQueue({ error, timestamp: Date.now() });
 *     return { handled: true };
 *   }),
 * });
 * ```
 *
 * @category orchestrate
 */
export function onFailure<T>(
	dep: string,
	handler: (signal: AbortSignal, error: unknown) => T | Promise<T>,
	opts?: OnFailureOpts,
): OnFailureStepDef<T> {
	const ts = taskState<T>({ id: opts?.name });

	const factory = (...depStores: Store<any>[]): Store<T | undefined> => {
		const errorStore$ = depStores[0]; // Resolved to "dep.error" by pipeline

		const switched = pipe(
			errorStore$,
			switchMap((error: unknown) => {
				// Skip when error is undefined (no failure / reset state).
				// Don't emit — just complete so switchMap waits.
				if (error === undefined) {
					return producer<T | undefined>(({ complete }) => {
						complete();
						return undefined;
					});
				}

				ts.restart();

				return producer<T | undefined>(({ emit, complete }) => {
					let stopped = false;
					let statusUnsub: Subscription | null = null;

					const safeEmit = (v: T | undefined) => {
						if (!stopped) emit(v);
					};
					const safeComplete = () => {
						if (!stopped) complete();
					};

					ts.run((signal) => handler(signal, error));

					statusUnsub = subscribe(ts.status, (s) => {
						if (s === "running" || s === "idle") return;
						statusUnsub?.unsubscribe();
						statusUnsub = null;
						if (s === "success") {
							safeEmit(ts.result.get() as T);
							safeComplete();
						} else {
							safeEmit(undefined);
							safeComplete();
						}
					});

					return () => {
						stopped = true;
						statusUnsub?.unsubscribe();
						statusUnsub = null;
					};
				});
			}),
		) as Store<T | undefined>;

		// Lifecycle signal interceptor — RESET/TEARDOWN cascade through the graph
		// instead of requiring flat task list iteration.
		return operator<T | undefined>(
			[switched] as Store<unknown>[],
			({ emit, signal, complete, error: actionsError }) => {
				return (_dep, type, data) => {
					if (type === STATE) {
						if (data === RESET) {
							ts.reset();
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
			{ kind: "onFailure", name: opts?.name },
		) as Store<T | undefined>;
	};

	const def: OnFailureStepDef<T> = {
		factory: factory as any,
		deps: [`${dep}.error`],
		name: opts?.name,
		status: ts.status,
		error: ts.error,
		duration: ts.duration,
		runCount: ts.runCount,
		[TASK_STATE]: ts,
		[ON_FAILURE_ROLE]: true,
	} as any;

	return def;
}
