import { Bitmask } from "../core/bitmask";
import { operator } from "../core/operator";
import { DATA, DIRTY, END, RESOLVED, STATE } from "../core/protocol";
import type { Store } from "../core/types";

/**
 * Builds a tuple store from multiple sources; updates when any dep changes (multi-dep Tier 1).
 *
 * @param sources - Stores whose values become tuple elements in order.
 *
 * @returns `Store<[...]>` — typed tuple of each store’s `T`.
 *
 * @remarks **New array:** Each recompute uses a fresh tuple reference.
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
	const values = sources.map((s) => s.get());

	return operator<Result>(
		sources as Store<unknown>[],
		({ emit, signal, complete, error }) => {
			const dirtyDeps = new Bitmask(sources.length);
			let anyDataReceived = false;
			let activeCount = sources.length;

			return (dep, type, data) => {
				if (type === STATE) {
					if (data === DIRTY) {
						const wasClean = dirtyDeps.empty();
						dirtyDeps.set(dep);
						if (wasClean) {
							anyDataReceived = false;
							signal(DIRTY);
						}
					} else if (data === RESOLVED) {
						if (dirtyDeps.test(dep)) {
							dirtyDeps.clear(dep);
							if (dirtyDeps.empty()) {
								if (anyDataReceived) {
									emit([...values] as unknown as Result);
								} else {
									signal(RESOLVED);
								}
							}
						}
					} else {
						signal(data); // Forward unknown STATE signals (v4 forward-compat)
					}
				}
				if (type === DATA) {
					values[dep] = data;
					if (dirtyDeps.test(dep)) {
						dirtyDeps.clear(dep);
						anyDataReceived = true;
						if (dirtyDeps.empty()) {
							emit([...values] as unknown as Result);
						}
					} else {
						// DATA without prior DIRTY (raw callbag source)
						if (dirtyDeps.empty()) {
							signal(DIRTY);
							emit([...values] as unknown as Result);
						} else {
							anyDataReceived = true;
						}
					}
				}
				if (type === END) {
					if (data !== undefined) {
						error(data);
					} else {
						activeCount--;
						if (activeCount === 0) complete();
					}
				}
			};
		},
		{
			kind: "combine",
			name: "combine",
			initial: [...values] as unknown as Result,
			getter: () => sources.map((s) => s.get()) as unknown as Result,
		},
	);
}
