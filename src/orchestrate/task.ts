// ---------------------------------------------------------------------------
// task — value-level pipeline step with automatic join, lifecycle, and re-trigger
// ---------------------------------------------------------------------------
// High-level building block for pipeline(). Users write plain functions that
// receive VALUES (not stores). The framework handles:
//   1. Diamond resolution (auto combine + undefined guard for all deps)
//   2. Re-trigger cancellation (auto switchMap + stopped flag)
//   3. Task lifecycle (auto taskState + producer with correct emit/complete timing)
//   4. Error handling (fallback option)
//   5. Resilience (retry + timeout options)
//
// Usage:
//   const wf = pipeline({
//     trigger: step(fromTrigger<string>()),
//     fetch:   task(["trigger"], async (v) => fetchData(v), { retry: 3 }),
//     join:    task(["a", "b"], async (a, b) => merge(a, b)),
//   });
// ---------------------------------------------------------------------------

import { operator } from "../core/operator";
import { pipe } from "../core/pipe";
import { producer } from "../core/producer";
import { DATA, END, RESET, STATE, TEARDOWN } from "../core/protocol";
import type { Store } from "../core/types";
import { combine } from "../extra/combine";
import { switchMap } from "../extra/switchMap";
import type { RetryOptions } from "../utils/retry";
import type { StepDef } from "./pipeline";
import { taskState } from "./taskState";
import type { TaskState } from "./types";
import { TASK_STATE } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskOpts<T> {
	/** Debug name for Inspector. */
	name?: string;
	/** Skip predicate: when true, emit null without running the task. */
	skip?: (values: any[]) => boolean;
	/** Fallback value or factory on error (after retries exhausted). */
	fallback?: T | ((error: unknown) => T);
	/** Retry count or full retry options. */
	retry?: number | RetryOptions;
	/** Timeout in milliseconds. */
	timeout?: number;
}

/** Extended StepDef that carries task metadata as flat companion stores. */
export interface TaskStepDef<T = any> extends StepDef<T> {
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
// Overloads
// ---------------------------------------------------------------------------

/**
 * Creates a value-level pipeline step with automatic lifecycle management.
 *
 * Unlike `step()`, the factory receives **values** (not stores) and the framework
 * handles diamond resolution, re-trigger cancellation, and task status tracking.
 *
 * @param fn - Function receiving `(signal, values)`. Signal is an AbortSignal aborted on reset/destroy.
 *   Values is an array of resolved dep values. No-deps overload receives `(signal)` only.
 * @param opts - Optional configuration (skip, fallback, retry, timeout).
 *
 * @returns `TaskStepDef<T>` — step definition for pipeline() with internal task tracking.
 *
 * @remarks **Auto-join:** Deps wait for ALL deps to emit non-undefined values before calling fn.
 * @remarks **Re-trigger:** New upstream values cancel the previous in-flight execution (switchMap semantics).
 * @remarks **Task tracking:** Internal `taskState` tracks status/duration/errors. Pipeline auto-detects it for `runStatus`.
 * @remarks **Cancellation:** The AbortSignal is aborted on re-trigger, reset, or destroy. Forward it to fetch(), etc.
 *
 * @example
 * ```ts
 * import { pipeline, step, task, fromTrigger } from 'callbag-recharge/orchestrate';
 *
 * const wf = pipeline({
 *   trigger: step(fromTrigger<string>()),
 *   fetch:   task(["trigger"], async (signal, [v]) => {
 *     const res = await fetch(`/api/${v}`, { signal });
 *     return res.json();
 *   }, { retry: 3, timeout: 5000 }),
 * });
 * ```
 *
 * @category orchestrate
 */
export function task<T>(
	fn: (signal: AbortSignal) => T | Promise<T>,
	opts?: TaskOpts<T>,
): TaskStepDef<T>;
export function task<T>(
	deps: string[],
	fn: (signal: AbortSignal, values: any[]) => T | Promise<T>,
	opts?: TaskOpts<T>,
): TaskStepDef<T>;
export function task<T>(
	depsOrFn: string[] | ((signal: AbortSignal) => T | Promise<T>),
	fnOrOpts?: ((signal: AbortSignal, values: any[]) => T | Promise<T>) | TaskOpts<T>,
	maybeOpts?: TaskOpts<T>,
): TaskStepDef<T> {
	// Parse overloads
	let deps: string[];
	let fn: (signal: AbortSignal, values: any[]) => T | Promise<T>;
	let opts: TaskOpts<T> | undefined;

	if (Array.isArray(depsOrFn)) {
		deps = depsOrFn;
		fn = fnOrOpts as (signal: AbortSignal, values: any[]) => T | Promise<T>;
		opts = maybeOpts;
	} else {
		deps = [];
		const noDepsFn = depsOrFn as (signal: AbortSignal) => T | Promise<T>;
		fn = (signal: AbortSignal) => noDepsFn(signal);
		opts = fnOrOpts as TaskOpts<T> | undefined;
	}

	const ts = taskState<T>({ id: opts?.name });
	const skipPred = opts?.skip;
	const fallbackOpt = opts?.fallback;
	const retryOpt = opts?.retry;
	const timeoutOpt = opts?.timeout;

	// Resolve retry config
	const retryCount =
		retryOpt === undefined ? 0 : typeof retryOpt === "number" ? retryOpt : (retryOpt.count ?? 3);
	const retryDelay =
		retryOpt !== undefined && typeof retryOpt !== "number" ? retryOpt.delay : undefined;
	const retryWhile =
		retryOpt !== undefined && typeof retryOpt !== "number" ? retryOpt.while : undefined;

	// Build the factory that receives dep stores and returns the output store
	const factory = (...depStores: Store<any>[]): Store<T | null> => {
		// Source store: combine deps or use single dep directly
		let source$: Store<any>;
		if (depStores.length === 0) {
			// No deps — use a dummy source that emits once
			source$ = producer<null>(({ emit }) => {
				emit(null);
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

				// Skip predicate
				if (skipPred?.(values)) {
					return producer<T | null>(({ emit, complete }) => {
						emit(null);
						complete();
						return undefined;
					});
				}

				// Reset taskState for re-trigger: switchMap cancels the previous inner
				// producer, but the old task.run() may still be in-flight. Reset ensures
				// the new run() won't throw "Task is already running".
				ts.restart();

				// Run the task with cancellation support
				return producer<T | null>(({ emit, complete }) => {
					let stopped = false;
					let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
					let delayTimer: ReturnType<typeof setTimeout> | null = null;

					const safeEmit = (v: T | null) => {
						if (!stopped) emit(v);
					};
					const safeComplete = () => {
						if (!stopped) complete();
					};

					const runTask = async (attempt: number): Promise<void> => {
						if (stopped) return;
						try {
							const result = await ts.run(async (signal) => {
								let maybePromise = fn(signal, values);

								// Guard: async generators silently resolve to the generator
								// object instead of yielded values. Detect and throw early.
								if (
									maybePromise != null &&
									typeof (maybePromise as any)[Symbol.asyncIterator] === "function"
								) {
									throw new Error(
										"task() does not support async generators. " +
											"Use step() + fromAsyncIter() for multi-value async streams.",
									);
								}

								// Apply timeout if configured
								if (timeoutOpt !== undefined && maybePromise instanceof Promise) {
									maybePromise = Promise.race([
										maybePromise,
										new Promise<never>((_, reject) => {
											timeoutTimer = setTimeout(() => {
												timeoutTimer = null;
												reject(new Error(`Timeout: ${timeoutOpt}ms`));
											}, timeoutOpt);
										}),
									]);
								}

								const r = await maybePromise;
								if (timeoutTimer !== null) {
									clearTimeout(timeoutTimer);
									timeoutTimer = null;
								}
								safeEmit(r);
								safeComplete();
								return r;
							});
							// Result already emitted inside task.run body
							void result;
						} catch (e) {
							if (stopped) return;
							// Retry logic
							if (attempt < retryCount) {
								if (retryWhile && !retryWhile(e)) {
									// Predicate says don't retry
									handleError(e);
									return;
								}
								const delay = retryDelay ? retryDelay(attempt, e) : 0;
								if (delay === null) {
									handleError(e);
									return;
								}
								ts.reset(); // Reset so we can run() again
								if (delay > 0) {
									await new Promise<void>((r) => {
										delayTimer = setTimeout(() => {
											delayTimer = null;
											r();
										}, delay);
									});
								}
								if (stopped) return;
								return runTask(attempt + 1);
							}
							handleError(e);
						}
					};

					const handleError = (e: unknown) => {
						if (stopped) return;
						if (fallbackOpt !== undefined) {
							const val =
								typeof fallbackOpt === "function"
									? (fallbackOpt as (e: unknown) => T)(e)
									: fallbackOpt;
							safeEmit(val);
							safeComplete();
						} else {
							safeEmit(null);
							safeComplete();
						}
					};

					runTask(0).catch(() => {
						// Swallowed — already handled inside
					});
					return () => {
						stopped = true;
						if (timeoutTimer !== null) {
							clearTimeout(timeoutTimer);
							timeoutTimer = null;
						}
						if (delayTimer !== null) {
							clearTimeout(delayTimer);
							delayTimer = null;
						}
					};
				});
			}),
		) as Store<T | null>;

		// Wrap with lifecycle signal interceptor — when RESET/TEARDOWN arrives
		// via talkback, delegate to taskState so pipeline doesn't need a flat task list.
		// OperatorImpl._handleLifecycleSignal dispatches signal to handler via STATE.
		return operator<T | null>(
			[switched] as Store<unknown>[],
			({ emit, signal, complete, error: actionsError }) => {
				return (_dep, type, data) => {
					if (type === STATE) {
						if (data === RESET) {
							ts.reset();
							// Don't forward RESET downstream — operator already handled it
							return;
						}
						if (data === TEARDOWN) {
							ts.destroy();
							// Don't forward — operator will call complete() after this
							return;
						}
						signal(data);
					} else if (type === DATA) {
						emit(data as T | null);
					} else if (type === END) {
						data !== undefined ? actionsError(data) : complete();
					}
				};
			},
			{ kind: "task", name: opts?.name },
		) as Store<T | null>;
	};

	const def: TaskStepDef<T> = {
		factory: factory as any,
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
