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
//     sub: subPipeline(["trigger"], (signal, [v]) => ({
//       steps: {
//         fetch:   task([], async (signal) => fetchData(v)),
//         process: task(["fetch"], async (signal, [d]) => transform(d)),
//       },
//       output: "process",
//     })),
//   });
// ---------------------------------------------------------------------------

import { operator } from "../core/operator";
import { pipe } from "../core/pipe";
import { producer } from "../core/producer";
import { DATA, END, RESET, STATE, type Subscription, TEARDOWN } from "../core/protocol";
import type { Store } from "../core/types";
import { combine } from "../extra/combine";
import { firstValueFrom } from "../extra/firstValueFrom";
import { subscribe } from "../extra/subscribe";
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
export interface SubPipelineStepDef<T = any> extends StepDef<T | undefined> {
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
 * @param factory - Function receiving `(signal, values)`. Signal is aborted on reset/destroy. Values is an array of dep values. Returns a `SubPipelineDef` describing the child pipeline.
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
 *   sub: subPipeline(["trigger"], (signal, [url]) => ({
 *     steps: {
 *       fetch:   task([], async (signal) => {
 *         const res = await fetch(url);
 *         return res.json();
 *       }),
 *       process: task(["fetch"], async (signal, [data]) => transform(data)),
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
	factory: (signal: AbortSignal, values: any[]) => SubPipelineDef,
	opts?: SubPipelineOpts,
): SubPipelineStepDef<T> {
	const ts = taskState<T>({ id: opts?.name });

	const stepFactory = (...depStores: Store<any>[]): Store<T | undefined> => {
		// Source store: combine deps or use single dep directly
		let source$: Store<any>;
		if (depStores.length === 0) {
			source$ = producer<true>(({ emit }) => {
				emit(true);
				return undefined;
			});
		} else if (depStores.length === 1) {
			source$ = depStores[0];
		} else {
			source$ = combine(...depStores);
		}

		const switched = pipe(
			source$,
			switchMap((raw: any) => {
				// Unpack values from combine tuple or single value
				const values: any[] =
					depStores.length > 1 ? (raw as any[]) : depStores.length === 1 ? [raw] : [];

				// Undefined guard: don't emit, just complete so switchMap waits
				if (depStores.length >= 1) {
					for (const v of values) {
						if (v === undefined) {
							return producer<T | undefined>(({ complete }) => {
								complete();
								return undefined;
							});
						}
					}
				}

				ts.restart();

				return producer<T | undefined>(({ emit, complete }) => {
					let stopped = false;
					let emitted = false;
					let childPipeline: PipelineResult<any> | null = null;
					let statusUnsub: Subscription | null = null;

					const safeEmit = (v: T | undefined) => {
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
						statusUnsub?.unsubscribe();
						statusUnsub = null;
						if (childPipeline) {
							childPipeline.destroy();
							childPipeline = null;
						}
					};

					ts.run(async (signal) => {
						// Create child pipeline
						const def = factory(signal, values);
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

						// Wait for child pipeline to reach a terminal status
						const terminalStatus = await firstValueFrom<string>(
							child.status,
							(s) => s === "completed" || s === "errored",
						);

						if (terminalStatus === "errored") {
							throw new Error("subPipeline: child pipeline errored");
						}

						return outputStore.get() as T;
					});

					statusUnsub = subscribe(ts.status, (s) => {
						if (s === "running" || s === "idle") return;
						statusUnsub?.unsubscribe();
						statusUnsub = null;
						if (s === "success") {
							safeEmit(ts.result.get() as T);
							safeComplete();
						} else if (!stopped && !emitted) {
							safeEmit(undefined);
							safeComplete();
						}
					});

					return cleanup;
				});
			}),
		) as Store<T | undefined>;

		// Wrap with lifecycle signal interceptor — when RESET/TEARDOWN arrives
		// via talkback, delegate to taskState so pipeline doesn't need a flat task list.
		return operator<T | undefined>(
			[switched] as Store<unknown>[],
			({ emit, signal, complete, error: actionsError }) => {
				return (_dep, type, data) => {
					if (type === STATE) {
						if (data === RESET) {
							// restart() preserves runCount/result/lastRun so
							// cumulative metrics survive pipeline re-triggers.
							ts.restart();
							return;
						}
						if (data === TEARDOWN) {
							ts.destroy();
							// Don't forward — operator will call complete() after this
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
			{ kind: "subPipeline", name: opts?.name },
		) as Store<T | undefined>;
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
