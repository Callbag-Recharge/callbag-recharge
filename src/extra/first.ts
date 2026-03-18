import { operator } from "../core/operator";
import { DATA, END, STATE } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";

/**
 * Emits the first upstream value then completes (same idea as `take(1)`).
 *
 * @returns `StoreOperator<A, A | undefined>` — Tier 1.
 *
 * @seeAlso [take](/api/take)
 *
 * @category extra
 */
export function first<A>(): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		return operator<A | undefined>(
			[input] as Store<unknown>[],
			({ emit, signal, complete, error, disconnect }) => {
				let done = false;

				return (_dep, type, data) => {
					if (type === STATE) {
						if (!done) signal(data);
					}
					if (type === DATA) {
						if (!done) {
							done = true;
							emit(data as A);
							disconnect();
							complete();
						}
					}
					if (type === END) {
						if (!done) {
							done = true;
							if (data !== undefined) {
								error(data);
							} else {
								complete();
							}
						}
					}
				};
			},
		);
	};
}
