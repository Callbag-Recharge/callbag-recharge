import { operator } from "../core/operator";
import { DATA, END, STATE } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";

/**
 * Side-effect passthrough operator. Calls `fn` for each upstream value
 * without altering it. Useful for debugging and logging.
 *
 * Stateful: maintains cached value via operator()'s internal cache.
 * get() returns the last received value.
 *
 * v3: Tier 1 — uses operator() with single dep. Forwards all type 3
 * STATE signals unchanged; calls fn and emits each type 1 DATA value.
 */
export function tap<A>(fn: (value: A) => void): StoreOperator<A, A> {
	return (input: Store<A>) => {
		return operator<A>(
			[input] as Store<unknown>[],
			({ emit, signal, complete, error }) => {
				return (_dep, type, data) => {
					if (type === STATE) {
						signal(data);
					}
					if (type === DATA) {
						fn(data as A);
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
			{ kind: "tap", name: "tap", initial: input.get(), getter: () => input.get() },
		);
	};
}
