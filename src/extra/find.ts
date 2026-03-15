import { operator } from "../core/operator";
import { DATA, END, RESOLVED, STATE } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";

/**
 * Emits the first value matching the predicate, then disconnects and completes.
 * If upstream completes without a match, sends END with no DATA.
 *
 * Stateful: maintains the matched value. get() returns undefined before a
 * match, then the matched value (frozen after completion).
 *
 * v3: Tier 1 — uses operator() with single dep. Forwards STATE signals
 * until a match is found. On match, emits DATA, disconnects upstream,
 * and completes. On non-matching DATA, sends RESOLVED to downstream
 * (value was dirty but didn't change).
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
