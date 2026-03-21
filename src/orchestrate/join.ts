// ---------------------------------------------------------------------------
// join — merge strategies pipeline step (Phase 5b-7)
// ---------------------------------------------------------------------------
// Data-level merge for multiple pipeline deps. Goes beyond task()'s diamond
// resolution (which just combines into a tuple) by providing built-in merge
// semantics: append (concatenate arrays), merge-by-key (full outer join),
// and intersect (inner join by key).
//
// Usage:
//   const wf = pipeline({
//     users: task(["trigger"], async () => fetchUsers()),
//     scores: task(["trigger"], async () => fetchScores()),
//     merged: join(["users", "scores"], { merge: u => u.id }),
//   });
// ---------------------------------------------------------------------------

import { operator } from "../core/operator";
import { pipe } from "../core/pipe";
import { producer } from "../core/producer";
import { DATA, END, RESET, STATE, TEARDOWN } from "../core/protocol";
import type { Store } from "../core/types";
import { combine } from "../extra/combine";
import { switchMap } from "../extra/switchMap";
import type { StepDef } from "./pipeline";
import { taskState } from "./taskState";
import type { TaskState } from "./types";
import { TASK_STATE } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JoinOpts {
	/** Debug name for Inspector. */
	name?: string;
}

/** Merge strategy: concatenate arrays from all deps. */
export type AppendStrategy = "append";

/** Merge strategy: full outer join by key (Object.assign on matching keys). */
export interface MergeStrategy<T> {
	merge: (item: T) => string | number;
}

/** Merge strategy: inner join — only items whose key exists in ALL deps. */
export interface IntersectStrategy<T> {
	intersect: (item: T) => string | number;
}

export type JoinStrategy<T> = AppendStrategy | MergeStrategy<T> | IntersectStrategy<T>;

/** Extended StepDef that carries task metadata as flat companion stores. */
export interface JoinStepDef<T = any> extends StepDef<T[]> {
	/** Step kind discriminator for diagram detection. */
	readonly _kind: "join";
	/** Reactive task status: idle → running → success/error. */
	readonly status: Store<import("./types").TaskStatus>;
	/** Last error, if any. */
	readonly error: Store<unknown | undefined>;
	/** Duration of last run in ms. */
	readonly duration: Store<number | undefined>;
	/** Total number of completed runs. */
	readonly runCount: Store<number>;
	/** @internal Pipeline auto-detection symbol. */
	readonly [TASK_STATE]: TaskState<T[]>;
}

// ---------------------------------------------------------------------------
// Strategy implementations
// ---------------------------------------------------------------------------

function applyAppend<T>(arrays: T[][]): T[] {
	const result: T[] = [];
	for (const arr of arrays) {
		for (const item of arr) result.push(item);
	}
	return result;
}

function applyMerge<T extends Record<string, any>>(
	arrays: T[][],
	keyFn: (item: T) => string | number,
): T[] {
	// Full outer join: items with matching keys get Object.assign'd,
	// unmatched items pass through in encounter order.
	const map = new Map<string | number, T>();
	const order: (string | number)[] = [];

	for (const arr of arrays) {
		for (const item of arr) {
			const k = keyFn(item);
			if (map.has(k)) {
				map.set(k, Object.assign({}, map.get(k)!, item));
			} else {
				order.push(k);
				map.set(k, Object.assign({}, item));
			}
		}
	}

	return order.map((k) => map.get(k)!);
}

function applyIntersect<T extends Record<string, any>>(
	arrays: T[][],
	keyFn: (item: T) => string | number,
): T[] {
	if (arrays.length === 0) return [];

	// Build key sets for each dep
	const keySets = arrays.map((arr) => new Set(arr.map(keyFn)));

	// Find keys present in ALL deps
	const commonKeys = new Set<string | number>();
	for (const k of keySets[0]) {
		if (keySets.every((s) => s.has(k))) commonKeys.add(k);
	}

	// Merge matching items (same as merge, but only for common keys)
	const map = new Map<string | number, T>();
	const order: (string | number)[] = [];

	for (const arr of arrays) {
		for (const item of arr) {
			const k = keyFn(item);
			if (!commonKeys.has(k)) continue;
			if (map.has(k)) {
				map.set(k, Object.assign({}, map.get(k)!, item));
			} else {
				order.push(k);
				map.set(k, Object.assign({}, item));
			}
		}
	}

	return order.map((k) => map.get(k)!);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a data-merge pipeline step. Joins arrays from multiple upstream deps
 * using configurable strategies: append (concatenate), merge-by-key (full outer
 * join), or intersect (inner join).
 *
 * @param deps - Names of upstream steps (must each emit `T[]`). Requires 2+.
 * @param strategy - `"append"`, `{ merge: keyFn }`, or `{ intersect: keyFn }`.
 * @param opts - Optional configuration (name).
 *
 * @returns `JoinStepDef<T>` — step definition for pipeline() with task tracking.
 *
 * @remarks **Requires 2+ deps.** For single-dep transforms, use `task()`.
 * @remarks **Array inputs required.** All deps must emit arrays. Non-array or undefined values are skipped.
 * @remarks **Re-trigger:** New upstream values cancel the previous computation (switchMap semantics).
 * @remarks **Task tracking:** Internal `taskState` tracks status/duration/errors. Pipeline auto-detects it.
 *
 * @example
 * ```ts
 * import { pipeline, step, task, join, fromTrigger } from 'callbag-recharge/orchestrate';
 *
 * const wf = pipeline({
 *   trigger: step(fromTrigger<void>()),
 *   users:  task(["trigger"], async () => [{ id: 1, name: "Alice" }]),
 *   scores: task(["trigger"], async () => [{ id: 1, score: 100 }]),
 *   merged: join(["users", "scores"], { merge: (item) => item.id }),
 * });
 * // merged.get() → [{ id: 1, name: "Alice", score: 100 }]
 * ```
 *
 * @category orchestrate
 */
export function join<T>(
	deps: string[],
	strategy: JoinStrategy<T>,
	opts?: JoinOpts,
): JoinStepDef<T> {
	if (deps.length < 2) {
		throw new Error("join() requires at least 2 deps");
	}

	const ts = taskState<T[]>({ id: opts?.name });

	const factory = (...depStores: Store<any>[]): Store<T[] | null> => {
		const source$ = combine(...depStores);

		const switched = pipe(
			source$,
			switchMap((raw: any[]) => {
				// Undefined guard: wait for ALL deps to have real array values
				for (const v of raw) {
					if (v === undefined || v === null) {
						return producer<T[] | null>(({ emit, complete }) => {
							emit(null);
							complete();
							return undefined;
						});
					}
				}

				// Validate all values are arrays — track as error so pipeline status reflects failure
				for (let i = 0; i < raw.length; i++) {
					if (!Array.isArray(raw[i])) {
						const badIndex = i;
						ts.restart();
						return producer<T[] | null>(({ emit, complete }) => {
							ts.run(async (_signal) => {
								throw new TypeError(
									`join(): dep ${badIndex} emitted non-array value (${typeof raw[badIndex]})`,
								);
							}).catch(() => {
								emit(null);
								complete();
							});
							return undefined;
						});
					}
				}

				const arrays = raw as T[][];

				ts.restart();

				return producer<T[] | null>(({ emit, complete }) => {
					let stopped = false;

					ts.run(async (_signal) => {
						let result: T[];

						if (strategy === "append") {
							result = applyAppend(arrays);
						} else if ("merge" in strategy) {
							result = applyMerge(
								arrays as Record<string, any>[][],
								strategy.merge as (item: Record<string, any>) => string | number,
							) as T[];
						} else {
							result = applyIntersect(
								arrays as Record<string, any>[][],
								strategy.intersect as (item: Record<string, any>) => string | number,
							) as T[];
						}

						if (!stopped) {
							emit(result);
							complete();
						}
						return result;
					}).catch(() => {
						if (!stopped) {
							emit(null);
							complete();
						}
					});

					return () => {
						stopped = true;
					};
				});
			}),
		) as Store<T[] | null>;

		// Lifecycle signal interceptor — RESET/TEARDOWN cascade through the graph
		// instead of requiring flat task list iteration.
		return operator<T[] | null>(
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
						emit(data as T[] | null);
					} else if (type === END) {
						data !== undefined ? actionsError(data) : complete();
					}
				};
			},
			{ kind: "join", name: opts?.name },
		) as Store<T[] | null>;
	};

	const def: JoinStepDef<T> = {
		factory: factory as any,
		deps,
		name: opts?.name,
		_kind: "join",
		status: ts.status,
		error: ts.error,
		duration: ts.duration,
		runCount: ts.runCount,
		[TASK_STATE]: ts,
	};

	return def;
}
