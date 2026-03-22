// ---------------------------------------------------------------------------
// firstValueFrom — callbag-to-Promise bridge
// ---------------------------------------------------------------------------
// The ONE acceptable place for `new Promise` in the library. Business logic
// should never create Promises directly — use this bridge instead.
// ---------------------------------------------------------------------------

import type { CallbagSource } from "./subscribe";
import { rawSubscribe } from "./subscribe";

/**
 * Subscribes to a raw callbag source and resolves with the first value
 * matching the optional predicate. Pure callbag — no Store dependency.
 *
 * For Store objects (which need a `.get()` fast path), use `extra/firstValueFrom`.
 *
 * This is the canonical callbag → Promise bridge. Business logic should
 * use this instead of `new Promise`.
 *
 * @param source - A raw callbag source function.
 * @param predicate - Optional filter. If omitted, resolves with the first emission.
 *
 * @returns Promise that resolves with the matching value, or rejects if
 *          the source completes (END) without a match.
 *
 * @category raw
 */
export function firstValueFrom<T>(
	source: CallbagSource,
	predicate?: (value: T) => boolean,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const sub = rawSubscribe<T>(
			source,
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
