import { operator } from "../core/operator";
import { DATA, END, STATE } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";

/**
 * Passes through the first `n` value changes from upstream, then disconnects
 * and completes. Subsequent subscribers receive END immediately.
 *
 * Stateful: maintains own cached value. get() returns the last accepted
 * value (or undefined before first emission). Frozen after completion.
 *
 * v3: Tier 1 — uses operator() with single dep. Forwards STATE signals
 * while count < n. Counts only actual DATA emissions.
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
