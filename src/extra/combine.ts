import { derived } from "../core/derived";
import type { Store } from "../core/types";

/**
 * Builds a tuple store from multiple sources; updates when any dep changes (multi-dep Tier 1).
 *
 * @param sources - Stores whose values become tuple elements in order.
 *
 * @returns `Store<[...]>` — typed tuple of each store’s `T`.
 *
 * @remarks **New array:** Each recompute uses a fresh tuple reference.
 * @remarks **Fail-fast:** Terminates when any source ends (error or completion).
 *
 * @example
 * ```ts
 * import { state } from 'callbag-recharge';
 * import { combine } from 'callbag-recharge/extra';
 *
 * const a = state(1);
 * const b = state(2);
 * const c = combine(a, b);
 * c.get(); // [1, 2]
 * ```
 *
 * @seeAlso [merge](/api/merge), [withLatestFrom](/api/withLatestFrom) — latest value from secondary sources
 *
 * @category extra
 */
export function combine<Sources extends Store<unknown>[]>(
	...sources: Sources
): Store<{ [K in keyof Sources]: Sources[K] extends Store<infer T> ? T : never }> {
	type Result = {
		[K in keyof Sources]: Sources[K] extends Store<infer T> ? T : never;
	};

	return derived<Result>(
		sources as Store<unknown>[],
		() => sources.map((s) => s.get()) as unknown as Result,
		{ kind: "combine", name: "combine" },
	);
}
