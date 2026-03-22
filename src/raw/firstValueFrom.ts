// ---------------------------------------------------------------------------
// firstValueFrom — callbag-to-Promise bridge
// ---------------------------------------------------------------------------
// The ONE acceptable place for `new Promise` in the library. Business logic
// should never create Promises directly — use this bridge instead.
// ---------------------------------------------------------------------------

import { subscribe } from "../core/subscribe";
import type { Store } from "../core/types";

/**
 * Subscribes to a store and resolves with the first value matching the
 * optional predicate. Checks the current value immediately before waiting.
 *
 * This is the canonical callbag → Promise bridge. Business logic should
 * use this instead of `new Promise`.
 *
 * @param store - The store to observe.
 * @param predicate - Optional filter. If omitted, resolves with the first emission.
 *
 * @returns Promise that resolves with the matching value, or rejects if
 *          the source completes (END) without a match.
 *
 * @category raw
 */
export function firstValueFrom<T>(store: Store<T>, predicate?: (value: T) => boolean): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		// Fast path: current value already matches
		const current = store.get();
		if (!predicate || predicate(current)) {
			resolve(current);
			return;
		}

		const sub = subscribe(
			store,
			(value) => {
				if (!predicate || predicate(value)) {
					sub.unsubscribe();
					resolve(value);
				}
			},
			{
				onEnd: (err) => {
					reject(err ?? new Error("source completed without matching value"));
				},
			},
		);
	});
}
