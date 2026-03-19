import { derived } from "../core/derived";
import type { Store, StoreOperator, StoreOptions } from "../core/types";

/**
 * Transforms each upstream value through `fn`. Returns a `StoreOperator` for use with `pipe()`.
 *
 * @param fn - Transform function applied to each upstream value.
 * @param opts - Optional configuration.
 *
 * @returns `StoreOperator<A, B>` — a function that takes a `Store<A>` and returns a `Store<B>`.
 *
 * @optionsType StoreOptions
 * @option name | string | undefined | Debug name for Inspector.
 * @option equals | (a: B, b: B) => boolean | undefined | Push-phase memoization. When set, sends RESOLVED instead of DATA if value unchanged.
 *
 * @remarks **Tier 1:** Participates in diamond resolution. Forwards type 3 STATE signals from upstream.
 * @remarks **Stateful:** Maintains the last transformed value. `get()` returns `fn(input.get())` when disconnected (pull-compute).
 * @remarks **Push-phase memoization:** When `equals` is provided and the mapped result equals the previous value, a RESOLVED signal is sent instead of DATA, allowing downstream nodes to skip recomputation.
 *
 * @example
 * ```ts
 * import { state, pipe } from 'callbag-recharge';
 * import { map } from 'callbag-recharge/extra';
 *
 * const count = state(3);
 * const doubled = pipe(count, map(x => x * 2));
 * doubled.get(); // 6
 *
 * count.set(5);
 * doubled.get(); // 10
 * ```
 *
 * @example With equals for memoization
 * ```ts
 * import { state, pipe } from 'callbag-recharge';
 * import { map } from 'callbag-recharge/extra';
 *
 * const data = state({ x: 1, y: 2 });
 * const xOnly = pipe(data, map(d => d.x, { equals: Object.is }));
 *
 * data.set({ x: 1, y: 99 }); // xOnly sends RESOLVED — x didn't change
 * ```
 *
 * @example Chaining with other operators
 * ```ts
 * import { state, pipe } from 'callbag-recharge';
 * import { map, filter } from 'callbag-recharge/extra';
 *
 * const n = state(1);
 * const result = pipe(
 *   n,
 *   filter(x => x > 0),
 *   map(x => x * 10),
 * );
 * result.get(); // 10
 * ```
 *
 * @seeAlso [pipe](/api/pipe) — compose operators, [derived](/api/derived) — computed stores from dependencies
 *
 * @category extra
 */
export function map<A, B>(fn: (value: A) => B, opts?: StoreOptions): StoreOperator<A, B> {
	return (input: Store<A>) => {
		return derived<B>([input as Store<unknown>], () => fn(input.get()), {
			kind: "map",
			name: opts?.name ?? "map",
			equals: opts?.equals,
		});
	};
}
