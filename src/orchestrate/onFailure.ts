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
//     fetch:   task(["trigger"], async (v) => fetchData(v), { retry: 3 }),
//     dlq:     onFailure("fetch", async (err) => logToDeadLetter(err)),
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

export interface OnFailureOpts {
	/** Debug name for Inspector. */
	name?: string;
}

/** Extended StepDef that carries task metadata as flat companion stores. */
export interface OnFailureStepDef<T = any> extends StepDef<T | null> {
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
 * @param handler - Function receiving the error. Returns a value for downstream steps.
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
 *   fetch:   task(["trigger"], async (v) => fetchData(v), { retry: 3 }),
 *   dlq:     onFailure("fetch", async (error) => {
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
	handler: (error: unknown) => T | Promise<T>,
	opts?: OnFailureOpts,
): OnFailureStepDef<T> {
	const ts = taskState<T>({ id: opts?.name });

	const factory = (...depStores: Store<any>[]): Store<T | null> => {
		const errorStore$ = depStores[0]; // Resolved to "dep.error" by pipeline

		return pipe(
			errorStore$,
			switchMap((error: unknown) => {
				// Skip when error is undefined (no failure / reset state)
				if (error === undefined) {
					return producer<T | null>(({ emit, complete }) => {
						emit(null);
						complete();
						return undefined;
					});
				}

				ts.restart();

				return producer<T | null>(({ emit, complete }) => {
					let stopped = false;

					const safeEmit = (v: T | null) => {
						if (!stopped) emit(v);
					};
					const safeComplete = () => {
						if (!stopped) complete();
					};

					ts.run(async () => {
						const result = await handler(error);
						safeEmit(result);
						safeComplete();
						return result;
					}).catch(() => {
						// Handler itself failed — error tracked by taskState
						if (!stopped) {
							safeEmit(null);
							safeComplete();
						}
					});

					return () => {
						stopped = true;
					};
				});
			}),
		) as Store<T | null>;
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
	};

	return def;
}
