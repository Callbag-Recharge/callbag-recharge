import type { Store, StoreOperator } from "../types";

/**
 * No-op in callbag-recharge — stores are inherently shared (multicast).
 * Multiple subscribers connect to the same store instance.
 * Provided for API compatibility with callbag-basics.
 */
export function share<A>(): StoreOperator<A, A> {
	return (input: Store<A>) => input;
}
