import { subscribe } from "../subscribe";
import type { Store } from "../types";

/**
 * Subscribes to a store and calls `cb` for every value change.
 * Returns an unsubscribe function.
 *
 * Works as a curried sink: `forEach(cb)(store)`.
 */
export function forEach<T>(cb: (value: T) => void): (store: Store<T>) => () => void {
	return (store) => {
		return subscribe(store, (v) => cb(v));
	};
}
