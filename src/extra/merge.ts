import { Bitmask } from "../core/bitmask";
import { operator } from "../core/operator";
import { DATA, DIRTY, END, RESOLVED, STATE } from "../core/protocol";
import type { Store } from "../core/types";

/**
 * Merges multiple stores of the same type; the output holds the latest value from whichever source emitted last.
 *
 * @param sources - Two or more `Store<T>` inputs.
 *
 * @returns `Store<T | undefined>` — multi-dep Tier 1 node with bitmask dirty tracking.
 *
 * @remarks **Concurrent dirty:** Multiple deps dirty in one batch can yield multiple DATA without extra DIRTY; downstream handles per library rules.
 * @remarks **Completion:** Completes when all sources have completed without error.
 *
 * @example
 * ```ts
 * import { state } from 'callbag-recharge';
 * import { merge } from 'callbag-recharge/extra';
 *
 * const a = state(1);
 * const b = state(2);
 * const m = merge(a, b);
 * a.set(10);
 * m.get(); // 10
 * ```
 *
 * @seeAlso [combine](/api/combine), [race](/api/race) — first source to emit wins
 *
 * @category extra
 */
export function merge<T>(...sources: Store<T>[]): Store<T | undefined> {
	return operator<T | undefined>(
		sources as Store<unknown>[],
		({ emit, signal, complete, error }) => {
			const dirtyDeps = new Bitmask(sources.length);
			let activeCount = sources.length;

			return (dep, type, data) => {
				if (type === STATE) {
					if (data === DIRTY) {
						const wasClean = dirtyDeps.empty();
						dirtyDeps.set(dep);
						if (wasClean) signal(DIRTY);
					} else if (data === RESOLVED) {
						if (dirtyDeps.test(dep)) {
							dirtyDeps.clear(dep);
							if (dirtyDeps.empty()) signal(RESOLVED);
						}
					} else {
						signal(data); // Forward unknown STATE signals (v4 forward-compat)
					}
				}
				if (type === DATA) {
					dirtyDeps.clear(dep);
					emit(data as T);
				}
				if (type === END) {
					dirtyDeps.clear(dep);
					if (data !== undefined) {
						error(data);
					} else {
						activeCount--;
						if (activeCount === 0) complete();
					}
				}
			};
		},
		{ kind: "merge", name: "merge" },
	);
}
