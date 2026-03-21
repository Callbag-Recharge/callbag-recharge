import type { Subscription } from "../core/protocol";
import type { Store } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Curried sink: `forEach(cb)(store)` runs `cb` on each DATA after subscribe; returns Subscription.
 *
 * @param cb - Side effect per value.
 *
 * @returns Function taking `Store<T>` and returning `Subscription`.
 *
 * @seeAlso [subscribe](/api/subscribe)
 *
 * @category extra
 */
export function forEach<T>(cb: (value: T) => void): (store: Store<T>) => Subscription {
	return (store) => {
		return subscribe(store, (v) => cb(v));
	};
}
