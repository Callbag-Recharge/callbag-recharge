import type { Store } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Subscribes to a store and calls `cb` for every value change.
 * Returns an unsubscribe function. Works as a curried sink: `forEach(cb)(store)`.
 *
 * Stateless: does not produce a store. Pure sink — delegates to subscribe().
 *
 * v3: receives type 1 DATA only via subscribe(). No DIRTY awareness.
 */
export function forEach<T>(cb: (value: T) => void): (store: Store<T>) => () => void {
	return (store) => {
		return subscribe(store, (v) => cb(v));
	};
}
