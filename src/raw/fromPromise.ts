// ---------------------------------------------------------------------------
// rawFromPromise — Promise → raw callbag source
// ---------------------------------------------------------------------------
// Emits the resolved value once (DATA) then completes (END).
// Rejection → END with error. Zero core deps — pure callbag protocol.
// ---------------------------------------------------------------------------

import type { CallbagSource } from "./subscribe";

/**
 * Converts a `PromiseLike<T>` into a raw callbag source that emits the
 * resolved value once then completes. Rejections become END with error.
 *
 * @param promise - The promise (or thenable) to adapt.
 *
 * @returns A raw callbag source function.
 *
 * @category raw
 */
export function rawFromPromise<T>(promise: PromiseLike<T>): CallbagSource {
	return (type: number, sink?: any) => {
		if (type !== 0 /* START */) return;

		let cancelled = false;

		// Talkback: sink can send END to cancel
		sink(0 /* START */, (t: number) => {
			if (t === 2 /* END */) {
				cancelled = true;
			}
		});

		promise.then(
			(value) => {
				if (!cancelled) {
					sink(1 /* DATA */, value);
					// Re-check: sink may have called talkback(END) during DATA
					if (!cancelled) {
						sink(2 /* END */);
					}
				}
			},
			(reason) => {
				if (!cancelled) {
					sink(2 /* END */, reason);
				}
			},
		);
	};
}
