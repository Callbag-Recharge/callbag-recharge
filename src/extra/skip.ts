import { operator } from "../core/operator";
import { DATA, DIRTY, END, RESOLVED, STATE } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";

/**
 * Ignores the first `n` upstream DATA emissions, then mirrors the rest.
 *
 * @param n - Count of initial values to drop.
 *
 * @returns `StoreOperator<A, A | undefined>` — `undefined` until the first value after the skip window.
 *
 * @remarks **Tier 1:** During skip, DIRTY/RESOLVED handling keeps the graph consistent after the window.
 *
 * @example
 * ```ts
 * import { pipe } from 'callbag-recharge';
 * import { fromIter, skip } from 'callbag-recharge/extra';
 *
 * const s = pipe(fromIter([1, 2, 3]), skip(1));
 * // forwards 2, 3
 * ```
 *
 * @seeAlso [take](/api/take)
 *
 * @category extra
 */
export function skip<A>(n: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		return operator<A | undefined>(
			[input] as Store<unknown>[],
			({ emit, signal, complete, error }) => {
				let emissionCount = 0;

				return (_dep, type, data) => {
					if (type === STATE) {
						if (data === DIRTY || data === RESOLVED) {
							if (emissionCount >= n) signal(data);
						} else {
							signal(data); // Forward unknown STATE signals always (v4 forward-compat)
						}
					}
					if (type === DATA) {
						emissionCount++;
						if (emissionCount > n) {
							emit(data as A);
						}
					}
					if (type === END) {
						if (data !== undefined) {
							error(data);
						} else {
							complete();
						}
					}
				};
			},
			{ kind: "skip", name: "skip" },
		);
	};
}
