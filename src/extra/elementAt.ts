import { operator } from "../operator";
import { DATA, END, STATE } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Emits only the value at the given index (0-based), then disconnects and
 * completes. If upstream completes before reaching the index, sends END
 * with no DATA.
 *
 * Stateful: maintains the matched value. get() returns undefined until the
 * n-th value arrives, then the captured value (frozen after completion).
 *
 * v3: Tier 1 — uses operator() with single dep. Forwards STATE signals
 * until the target index is reached. Counts only actual DATA emissions.
 * On target, emits DATA, disconnects upstream, and completes.
 */
export function elementAt<A>(index: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		return operator<A | undefined>(
			[input] as Store<unknown>[],
			({ emit, signal, complete, disconnect }) => {
				let count = 0;
				let done = false;

				return (_dep, type, data) => {
					if (type === STATE) {
						if (!done) signal(data);
					}
					if (type === DATA) {
						if (!done) {
							if (count === index) {
								done = true;
								emit(data as A);
								disconnect();
								complete();
							}
							count++;
						}
					}
					if (type === END) {
						if (!done) {
							done = true;
							complete();
						}
					}
				};
			},
		);
	};
}
