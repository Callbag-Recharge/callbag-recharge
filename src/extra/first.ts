import { operator } from "../operator";
import { DATA, END, STATE } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Emits only the first value from upstream, then disconnects and completes.
 * Semantically equivalent to `take(1)`.
 *
 * Stateful: maintains the first received value. get() returns undefined
 * before first emission, then the captured value (frozen after completion).
 *
 * v3: Tier 1 — uses operator() with single dep. Forwards STATE signals
 * until first DATA arrives, then emits, disconnects upstream, and completes.
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
