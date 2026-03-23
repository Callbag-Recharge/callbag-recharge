// ---------------------------------------------------------------------------
// forEach — fan-out pipeline step (Phase 5b-2)
// ---------------------------------------------------------------------------
// Spawns N parallel task instances from an array dep. n8n "Split in Batches"
// / Airflow `expand()` equivalent. Requires exactly one dep that emits T[].
// To combine multiple deps before fan-out, use task() as a preceding step.
//
// Usage:
//   const wf = pipeline({
//     trigger: step(fromTrigger<string[]>()),
//     results: forEach("trigger", async (signal, item) => processItem(item)),
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

export interface ForEachOpts<R> {
	/** Debug name for Inspector. */
	name?: string;
	/** Maximum concurrency. Default: Infinity (all items in parallel). */
	concurrency?: number;
	/** Fallback value per item on error. If not set, item errors fail the whole batch. */
	fallback?: R | ((error: unknown, index: number) => R);
}

/** Extended StepDef that carries task metadata as flat companion stores. */
export interface ForEachStepDef<R = any> extends StepDef<R[]> {
	/** Reactive task status: idle → running → success/error. */
	readonly status: Store<import("./types").TaskStatus>;
	/** Last error, if any. */
	readonly error: Store<unknown | undefined>;
	/** Duration of last run in ms. */
	readonly duration: Store<number | undefined>;
	/** Total number of completed runs (cumulative across re-triggers). */
	readonly runCount: Store<number>;
	/** @internal Pipeline auto-detection symbol. */
	readonly [TASK_STATE]: TaskState<R[]>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Fan-out pipeline step. Receives an array from a single upstream dep and runs `fn`
 * for each item in parallel, collecting results into `R[]`.
 *
 * Requires exactly one dep that emits `T[]`. To combine multiple deps before fan-out,
 * use `task()` as a preceding step (or the future `join` step from 5b-7).
 *
 * @param dep - Name of the upstream step (must emit `T[]`).
 * @param fn - Function called per item. Receives `(signal, item, index)`, returns `R` or `Promise<R>`. Signal is aborted on re-trigger/reset/destroy.
 * @param opts - Optional configuration (name, concurrency, fallback).
 *
 * @returns `ForEachStepDef<R>` — step definition for pipeline() with task tracking.
 *
 * @remarks **Single dep:** Exactly one dep required. Use task() to combine multiple deps first.
 * @remarks **Parallel execution:** All items run concurrently by default. Set `concurrency` to limit.
 * @remarks **Task tracking:** Internal `taskState` tracks overall batch status/duration/errors. Pipeline auto-detects it.
 * @remarks **Re-trigger:** New upstream arrays cancel any in-flight batch (switchMap semantics). `runCount` accumulates across re-triggers.
 *
 * @example
 * ```ts
 * import { pipeline, step, forEach, fromTrigger } from 'callbag-recharge/orchestrate';
 *
 * const wf = pipeline({
 *   trigger: step(fromTrigger<string[]>()),
 *   results: forEach("trigger", async (signal, url) => {
 *     const res = await fetch(url);
 *     return res.json();
 *   }, { concurrency: 5 }),
 * });
 * ```
 *
 * @category orchestrate
 */
export function forEach<T, R>(
	dep: string,
	fn: (signal: AbortSignal, item: T, index: number) => R | Promise<R>,
	opts?: ForEachOpts<R>,
): ForEachStepDef<R> {
	const ts = taskState<R[]>({ id: opts?.name });
	const concurrency = opts?.concurrency ?? Number.POSITIVE_INFINITY;
	const fallbackOpt = opts?.fallback;

	const factory = (...depStores: Store<any>[]): Store<R[] | null> => {
		const source$ = depStores[0];

		return pipe(
			source$,
			switchMap((items: any) => {
				// Undefined guard
				if (items === undefined || items === null) {
					return producer<R[] | null>(({ emit, complete }) => {
						emit(null);
						complete();
						return undefined;
					});
				}

				if (!Array.isArray(items)) {
					return producer<R[] | null>(({ emit, complete }) => {
						emit(null);
						complete();
						return undefined;
					});
				}

				// Restart for re-trigger: preserves cumulative runCount
				ts.restart();

				return producer<R[] | null>(({ emit, complete }) => {
					let stopped = false;

					const safeEmit = (v: R[] | null) => {
						if (!stopped) emit(v);
					};
					const safeComplete = () => {
						if (!stopped) complete();
					};

					ts.run(async (signal) => {
						const results = await runWithConcurrency(
							items as T[],
							fn,
							signal,
							concurrency,
							fallbackOpt,
							() => stopped,
						);
						safeEmit(results);
						safeComplete();
						return results;
					}).catch(() => {
						// Error already tracked by taskState
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
		) as Store<R[] | null>;
	};

	const def: ForEachStepDef<R> = {
		factory: factory as any,
		deps: [dep],
		name: opts?.name,
		status: ts.status,
		error: ts.error,
		duration: ts.duration,
		runCount: ts.runCount,
		[TASK_STATE]: ts,
	};

	return def;
}

// ---------------------------------------------------------------------------
// Concurrency-limited parallel execution
// ---------------------------------------------------------------------------

async function runWithConcurrency<T, R>(
	items: T[],
	fn: (signal: AbortSignal, item: T, index: number) => R | Promise<R>,
	signal: AbortSignal,
	concurrency: number,
	fallback: R | ((error: unknown, index: number) => R) | undefined,
	isStopped: () => boolean,
): Promise<R[]> {
	if (items.length === 0) return [];

	// Unlimited concurrency — Promise.all with cancellation checks
	if (concurrency >= items.length) {
		return Promise.all(
			items.map((item, i) => {
				if (isStopped()) return undefined as any as R;
				return runOne(item, i, fn, signal, fallback);
			}),
		);
	}

	// Limited concurrency — worker pool
	const results = new Array<R>(items.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (nextIndex < items.length) {
			if (isStopped()) return;
			const i = nextIndex++;
			results[i] = await runOne(items[i], i, fn, signal, fallback);
		}
	}

	const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
	await Promise.all(workers);

	return results;
}

async function runOne<T, R>(
	item: T,
	index: number,
	fn: (signal: AbortSignal, item: T, index: number) => R | Promise<R>,
	signal: AbortSignal,
	fallback: R | ((error: unknown, index: number) => R) | undefined,
): Promise<R> {
	try {
		return await fn(signal, item, index);
	} catch (err) {
		if (fallback !== undefined) {
			return typeof fallback === "function"
				? (fallback as (error: unknown, index: number) => R)(err, index)
				: fallback;
		}
		throw err;
	}
}
