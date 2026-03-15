import { operator } from "../operator";
import { DATA, END, STATE } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Skips the first `n` value changes from upstream, then passes through all
 * subsequent ones.
 *
 * Stateful: maintains own cached value. get() returns undefined until the
 * first post-skip value arrives, then returns the last forwarded value.
 *
 * v3: Tier 1 — uses operator() with single dep. During the skip phase
 * (emissionCount < n), STATE signals are not forwarded and DATA values are
 * silently consumed. After n values, STATE and DATA forward normally.
 */
export function skip<A>(n: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		return operator<A | undefined>(
			[input] as Store<unknown>[],
			({ emit, signal, complete, error }) => {
				let emissionCount = 0;

				return (_dep, type, data) => {
					if (type === STATE) {
						if (emissionCount >= n) signal(data);
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
