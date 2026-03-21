// ---------------------------------------------------------------------------
// subPipeline — nested pipeline invocation step (Phase 5b-6)
// ---------------------------------------------------------------------------
// Invoke one pipeline from another with lifecycle management. n8n "Execute
// Workflow" equivalent. Each trigger creates a fresh child pipeline, runs it
// to completion, emits the output step's value, then destroys it.
//
// Usage:
//   const wf = pipeline({
//     trigger: step(fromTrigger<string>()),
//     sub: subPipeline(["trigger"], (v) => ({
//       steps: {
//         fetch:   task([], async () => fetchData(v)),
//         process: task(["fetch"], async (d) => transform(d)),
//       },
//       output: "process",
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

export interface SubPipelineDef {
	/** Record of step definitions for the child pipeline. */
	steps: Record<string, StepDef>;
	/** Name of the step whose value to emit as output. Defaults to last step in topological order. */
	output?: string;
	/** Optional name for the child pipeline (Inspector). */
	name?: string;
}

export interface SubPipelineOpts {
	/** Debug name for Inspector. */
	name?: string;
}

/** Extended StepDef that carries task metadata as flat companion stores. */
export interface SubPipelineStepDef<T = any> extends StepDef<T | null> {
	/** Reactive task status: idle → running → success/error. */
	readonly status: Store<import("./types").TaskStatus>;
	/** Last error, if any. */
	readonly error: Store<unknown | undefined>;
	/** Duration of last run in ms. */
	readonly duration: Store<number | undefined>;
	/** Total number of completed runs. */
	readonly runCount: Store<number>;
	/** @internal Pipeline auto-detection symbol. */
	readonly [TASK_STATE]: TaskState<T>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a nested pipeline invocation step. Each trigger creates a fresh
 * child pipeline, runs it to completion, and emits the output step's value.
 * Previous child pipelines are destroyed on re-trigger (switchMap semantics).
 *
 * @param deps - Names of upstream steps whose values are passed to the factory.
 * @param factory - Function receiving dep values, returns a `SubPipelineDef` describing the child pipeline.
 * @param opts - Optional configuration (name).
 *
 * @returns `SubPipelineStepDef<T>` — step definition for pipeline() with task tracking.
 *
 * @remarks **Lifecycle:** Every child pipeline created is guaranteed to be destroyed — either on re-trigger or parent destroy.
 * @remarks **Output:** The `output` field in `SubPipelineDef` specifies which child step's value to emit. Defaults to the last step in topological order.
 * @remarks **Task tracking:** Internal `taskState` tracks child pipeline execution. Pipeline auto-detects it for aggregate status.
 *
 * @example
 * ```ts
 * import { pipeline, step, task, subPipeline, fromTrigger } from 'callbag-recharge/orchestrate';
 *
 * const wf = pipeline({
 *   trigger: step(fromTrigger<string>()),
 *   sub: subPipeline(["trigger"], (url) => ({
 *     steps: {
 *       fetch:   task([], async () => {
 *         const res = await fetch(url);
 *         return res.json();
 *       }),
 *       process: task(["fetch"], async (data) => transform(data)),
 *     },
 *     output: "process",
 *   })),
 * });
 * ```
 *
 * @category orchestrate
 */
export function subPipeline<T>(
	deps: string[],
	factory: (...values: any[]) => SubPipelineDef,
	opts?: SubPipelineOpts,
): SubPipelineStepDef<T> {
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
					let statusUnsub: (() => void) | undefined;
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
							statusUnsub();
							statusUnsub = undefined;
						}
						// Reject pending Promise so it settles and frees closures
						if (pendingReject) {
							pendingReject(new Error("subPipeline: cancelled"));
							pendingReject = undefined;
						}
						if (childPipeline) {
							childPipeline.destroy();
							childPipeline = null;
						}
					};

					ts.run(async () => {
						// Create child pipeline
						const def = factory(...values);
						const outputName = def.output;

						const child = pipeline(def.steps, {
							name: def.name ?? opts?.name ?? "subPipeline",
						});
						childPipeline = child;

						// If torn down before we got here, destroy immediately
						if (stopped) {
							child.destroy();
							childPipeline = null;
							throw new Error("subPipeline: cancelled");
						}

						// Determine output step
						const outputKey = outputName ?? child.inner.order[child.inner.order.length - 1];
						const outputStore = child.steps[outputKey];
						if (!outputStore) {
							throw new Error(
								`subPipeline: output step "${outputKey}" not found in child pipeline`,
							);
						}

						// Wait for child pipeline to complete and collect output value
						return new Promise<T>((resolve, reject) => {
							pendingReject = reject;

							// Use settled flag to guard against subscribe delivering
							// terminal status synchronously (statusUnsub not assigned yet)
							let settled = false;
							statusUnsub = subscribe(child.status, (status) => {
								if (stopped || settled) return;
								if (status === "completed") {
									settled = true;
									statusUnsub?.();
									const result = outputStore.get() as T;
									// Clear pendingReject BEFORE safeComplete — complete()
									// synchronously triggers switchMap teardown → cleanup(),
									// which would call pendingReject if still set.
									pendingReject = undefined;
									safeEmit(result);
									safeComplete();
									resolve(result);
								} else if (status === "errored") {
									settled = true;
									statusUnsub?.();
									pendingReject = undefined;
									reject(new Error("subPipeline: child pipeline errored"));
								}
							});
						});
					}).catch(() => {
						// Error tracked by taskState
						if (!stopped && !emitted) {
							safeEmit(null);
							safeComplete();
						}
					});

					return cleanup;
				});
			}),
		) as Store<T | null>;
	};

	const def: SubPipelineStepDef<T> = {
		factory: stepFactory as any,
		deps,
		name: opts?.name,
		status: ts.status,
		error: ts.error,
		duration: ts.duration,
		runCount: ts.runCount,
		[TASK_STATE]: ts,
	};

	return def;
}
