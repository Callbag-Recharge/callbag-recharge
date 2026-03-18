import { operator } from "../core/operator";
import { DATA, END, RESOLVED, STATE } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";

/**
 * Emits the first value that satisfies `predicate`, then completes; no emission if upstream ends first.
 *
 * @param predicate - Test for each upstream value.
 *
 * @returns `StoreOperator<A, A | undefined>` — Tier 1.
 *
 * @category extra
 */
export function find<A>(predicate: (value: A) => boolean): StoreOperator<A, A | undefined> {
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
							if (predicate(data as A)) {
								done = true;
								emit(data as A);
								disconnect();
								complete();
							} else {
								// Non-matching: DIRTY was forwarded but value didn't change
								signal(RESOLVED);
							}
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
