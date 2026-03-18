import { operator } from "../core/operator";
import { DATA, END, STATE } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";

/**
 * Emits at most `n` DATA values from upstream, then completes and disconnects.
 *
 * @param n - Number of values to forward (`n <= 0` completes immediately with no DATA).
 *
 * @returns `StoreOperator<A, A | undefined>` — Tier 1; forwards STATE until the take limit is reached.
 *
 * @remarks **Completion:** After `n` emissions, upstream is disconnected to stop further work.
 *
 * @example
 * ```ts
 * import { pipe } from 'callbag-recharge';
 * import { fromIter, take } from 'callbag-recharge/extra';
 *
 * const s = pipe(fromIter([1, 2, 3]), take(2));
 * // emits 1, 2 then completes
 * ```
 *
 * @seeAlso [skip](/api/skip), [first](/api/first) — take only the first value
 *
 * @category extra
 */
export function take<A>(n: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		return operator<A | undefined>(
			[input] as Store<unknown>[],
			({ emit, signal, complete, error, disconnect }) => {
				let count = 0;

				if (n <= 0) {
					disconnect();
					complete();
				}

				return (_dep, type, data) => {
					if (type === STATE) {
						if (count < n) signal(data);
					}
					if (type === DATA) {
						if (count < n) {
							count++;
							emit(data as A);
							if (count >= n) {
								disconnect();
								complete();
							}
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
			{ kind: "take", name: "take" },
		);
	};
}
