import { operator } from "../core/operator";
import { DATA, END, STATE } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";

/**
 * Replays the last value to new subscribers; cache clears on last disconnect (`resetOnTeardown`) (Tier 1).
 *
 * @returns `StoreOperator<A, A | undefined>`
 *
 * @category extra
 */
export function remember<A>(): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		return operator<A | undefined>(
			[input] as Store<unknown>[],
			({ emit, seed, signal, complete, error }) => {
				// Re-seed on each (re)connect with current upstream value
				seed(input.get());

				return (_dep, type, data) => {
					if (type === STATE) {
						signal(data);
					}
					if (type === DATA) {
						emit(data as A);
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
			{ kind: "remember", name: "remember", resetOnTeardown: true },
		);
	};
}
