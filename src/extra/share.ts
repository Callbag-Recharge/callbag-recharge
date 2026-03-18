import type { Store, StoreOperator } from "../core/types";

/**
 * Identity operator for API compatibility — stores are already multicast (shared by reference).
 *
 * @returns `StoreOperator<A, A>` — returns the input store unchanged.
 *
 * @category extra
 */
export function share<A>(): StoreOperator<A, A> {
	return (input: Store<A>) => input;
}
