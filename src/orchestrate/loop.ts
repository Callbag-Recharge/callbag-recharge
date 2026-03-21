// ---------------------------------------------------------------------------
// loop — declarative iteration pipeline step (Phase 5b-11)
// ---------------------------------------------------------------------------
// Repeat a sub-graph until a condition is met. Each iteration creates a fresh
// child pipeline, runs it to completion, checks the predicate, and either
// emits or loops again. The Airflow "while loop" equivalent.
//
// Usage:
//   const wf = pipeline({
//     trigger: step(fromTrigger<number>()),
//     iterate: loop(["trigger"], (n) => ({
//       steps: {
//         double: task([], async () => n * 2),
//       },
//       output: "double",
//       predicate: (v) => v >= 100,
//     })),
//   });
// ---------------------------------------------------------------------------

import { pipe } from "../core/pipe";
import { producer } from "../core/producer";
import { subscribe } from "../core/subscribe";
import type { Store } from "../core/types";
import { combine } from "../extra/combine";
import { switchMap } from "../extra/switchMap";
import type { PipelineResult, StepDef } from "./pipeline";
import { pipeline } from "./pipeline";
import { taskState } from "./taskState";
import type { TaskState } from "./types";
import { TASK_STATE } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LoopDef<T> {
	/** Record of step definitions for each iteration's child pipeline. */
	steps: Record<string, StepDef>;
	/** Name of the step whose value to check and emit. */
	output: string;
	/** Return true when iteration should stop. Receives the output value and iteration index (0-based). */
	predicate: (value: T, iteration: number) => boolean;
	/** Optional name for child pipelines (Inspector). */
	name?: string;
}

export interface LoopOpts {
	/** Debug name for Inspector. */
	name?: string;
	/** Maximum number of iterations before erroring. Default: 100. */
	maxIterations?: number;
}

/** Extended StepDef that carries task metadata as flat companion stores. */
export interface LoopStepDef<T = any> extends StepDef<T | null> {
	/** Reactive task status: idle → running → success/error. */
	readonly status: Store<import("./types").TaskStatus>;
	/** Last error, if any. */
	readonly error: Store<unknown | undefined>;
	/** Duration of last run in ms. */
	readonly duration: Store<number | undefined>;
	/** Total number of completed runs. */
	readonly runCount: Store<number>;
	/** @internal Kind discriminator for diagram detection. */
	readonly _kind: "loop";
	/** @internal Pipeline auto-detection symbol. */
	readonly [TASK_STATE]: TaskState<T>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a declarative iteration step in a pipeline. Repeats a sub-graph
 * until the predicate returns true.
 *
 * Each iteration creates a fresh child pipeline from the factory, runs it to
 * completion, and checks the predicate against the output step's value. The
 * factory receives the previous iteration's output (or the original dep values
 * on the first iteration), enabling iterative refinement.
 *
 * @param deps - Names of upstream steps whose values are passed to the factory on the first iteration.
 * @param factory - Function receiving `(signal, values)`. Signal is aborted on reset/destroy. Values is an array (dep values on first iteration, previous output thereafter). Returns a `LoopDef` describing the child pipeline and termination condition.
 * @param opts - Optional configuration (name, maxIterations).
 *
 * @returns `LoopStepDef<T>` — step definition for pipeline() with task tracking.
 *
 * @remarks **Fresh pipeline:** Each iteration creates and destroys a child pipeline. No state leaks between iterations.
 * @remarks **Iteration values:** On iteration 0, factory receives the original dep values. On iteration 1+, factory receives a single argument: the previous iteration's output value. Design your factory accordingly (e.g., use a single-argument signature with iteration-aware logic).
 * @remarks **Predicate:** `predicate(value, iteration)` — return true to stop and emit the value.
 * @remarks **Safety:** `maxIterations` (default 100) prevents infinite loops. Exceeding it errors via taskState.
 * @remarks **Re-trigger:** New upstream values cancel the current iteration loop (switchMap semantics).
 *
 * @example
 * ```ts
 * import { pipeline, step, task, loop, fromTrigger } from 'callbag-recharge/orchestrate';
 *
 * // Double a number until it reaches 100
 * const wf = pipeline({
 *   trigger: step(fromTrigger<number>()),
 *   iterate: loop(["trigger"], (n) => ({
 *     steps: {
 *       double: task([], async () => n * 2),
 *     },
 *     output: "double",
 *     predicate: (v) => v >= 100,
 *   })),
 * });
 * ```
 *
 * @category orchestrate
 */
export function loop<T>(
	deps: string[],
	factory: (signal: AbortSignal, values: any[]) => LoopDef<T>,
	opts?: LoopOpts,
): LoopStepDef<T> {
	const maxIterations = opts?.maxIterations ?? 100;
	const ts = taskState<T>({ id: opts?.name });

	const stepFactory = (...depStores: Store<any>[]): Store<T | null> => {
		// Source store: combine deps or use single dep directly
		let source$: Store<any>;
		if (depStores.length === 0) {
			source$ = producer<null>(({ emit }) => {
				emit(null);
				return undefined;
			});
		} else if (depStores.length === 1) {
			source$ = depStores[0];
		} else {
			source$ = combine(...depStores);
		}

		return pipe(
			source$,
			switchMap((raw: any) => {
				// Unpack values from combine tuple or single value
				const values: any[] =
					depStores.length > 1 ? (raw as any[]) : depStores.length === 1 ? [raw] : [];

				// Undefined guard: wait for ALL deps to have real values
				if (depStores.length >= 1) {
					for (const v of values) {
						if (v === undefined) {
							return producer<T | null>(({ emit, complete }) => {
								emit(null);
								complete();
								return undefined;
							});
						}
					}
				}

				ts.restart();

				return producer<T | null>(({ emit, complete }) => {
					let stopped = false;
					let emitted = false;
					let childPipeline: PipelineResult<any> | null = null;
					let statusUnsub: { unsubscribe(): void } | undefined;
					let pendingReject: ((reason: unknown) => void) | undefined;

					const safeEmit = (v: T | null) => {
						if (!stopped && !emitted) {
							emitted = true;
							emit(v);
						}
					};
					const safeComplete = () => {
						if (!stopped) complete();
					};

					const cleanup = () => {
						stopped = true;
						if (statusUnsub) {
							statusUnsub.unsubscribe();
							statusUnsub = undefined;
						}
						if (pendingReject) {
							pendingReject(new Error("loop: cancelled"));
							pendingReject = undefined;
						}
						if (childPipeline) {
							childPipeline.destroy();
							childPipeline = null;
						}
					};

					ts.run(async (signal) => {
						let currentValues = [...values];
						let iteration = 0;

						while (!stopped && iteration < maxIterations) {
							// Call factory with current values
							const def = factory(signal, currentValues);
							const outputName = def.output;

							// Create child pipeline for this iteration
							const child = pipeline(def.steps, {
								name: def.name ?? opts?.name ?? `loop-iter-${iteration}`,
							});
							childPipeline = child;

							if (stopped) {
								child.destroy();
								childPipeline = null;
								throw new Error("loop: cancelled");
							}

							// Determine output step
							const outputStore = child.steps[outputName];
							if (!outputStore) {
								throw new Error(`loop: output step "${outputName}" not found in child pipeline`);
							}

							// Wait for child pipeline to complete
							const result = await new Promise<T>((resolve, reject) => {
								pendingReject = reject;

								let settled = false;
								statusUnsub = subscribe(child.status, (status) => {
									if (stopped || settled) return;
									if (status === "completed") {
										settled = true;
										statusUnsub?.unsubscribe();
										statusUnsub = undefined;
										pendingReject = undefined;
										resolve(outputStore.get() as T);
									} else if (status === "errored") {
										settled = true;
										statusUnsub?.unsubscribe();
										statusUnsub = undefined;
										pendingReject = undefined;
										reject(new Error("loop: child pipeline errored"));
									}
								});
								// If subscribe delivered terminal status synchronously,
								// statusUnsub wasn't assigned yet when the callback ran.
								// Clean it up now to prevent subscription leak.
								if (settled && statusUnsub) {
									statusUnsub.unsubscribe();
									statusUnsub = undefined;
								}
							});

							// Destroy child pipeline
							child.destroy();
							childPipeline = null;

							if (stopped) throw new Error("loop: cancelled");

							// Check predicate
							if (def.predicate(result, iteration)) {
								// Done — emit final value
								safeEmit(result);
								safeComplete();
								return result;
							}

							// Feed output into next iteration
							currentValues = [result];
							iteration++;
						}

						if (!stopped) {
							throw new Error(`loop: exceeded maxIterations (${maxIterations})`);
						}
						throw new Error("loop: cancelled");
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

	const def: LoopStepDef<T> = {
		factory: stepFactory as any,
		deps,
		name: opts?.name,
		_kind: "loop",
		status: ts.status,
		error: ts.error,
		duration: ts.duration,
		runCount: ts.runCount,
		[TASK_STATE]: ts,
	};

	return def;
}
