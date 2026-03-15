import { operator } from "../core/operator";
import { DATA, END, STATE } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";

/**
 * Caches the last upstream value and replays it to new subscribers.
 * Cache is cleared when the last sink disconnects (teardown).
 *
 * Stateful: maintains cached value via operator()'s internal cache.
 * get() returns the last received value. New subscribers receive the
 * cached value immediately via talkback.
 *
 * v3: Tier 1 — uses operator() with single dep. seed() re-reads
 * input.get() on each (re)connect. resetOnTeardown clears cache.
 * Forwards all type 3 STATE signals; updates cache and emits on type 1 DATA.
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
