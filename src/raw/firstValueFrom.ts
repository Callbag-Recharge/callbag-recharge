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
 * @param opts - Optional predicate filter and/or AbortSignal for cancellation.
 *
 * @returns Promise that resolves with the matching value, or rejects if
 *          the source completes (END) without a match or the signal is aborted.
 *
 * @remarks If the source never emits and no `signal` is provided, the returned
 *   Promise never settles and the subscription is never cleaned up. Always pass
 *   `signal` when subscribing to potentially non-completing sources.
 *
 * @category raw
 */
export function firstValueFrom<T>(
	source: CallbagSource,
	opts?: { predicate?: (value: T) => boolean; signal?: AbortSignal },
): Promise<T> {
	const predicate = opts?.predicate;
	const signal = opts?.signal;

	return new Promise<T>((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
			return;
		}

		let settled = false;

		const sub = rawSubscribe<T>(
			source,
			(value) => {
				if (!predicate || predicate(value)) {
					settled = true;
					cleanup();
					sub.unsubscribe();
					resolve(value);
				}
			},
			{
				onEnd: (err) => {
					if (settled) return;
					settled = true;
					cleanup();
					reject(err ?? new Error("source completed without matching value"));
				},
			},
		);

		function onAbort() {
			if (settled) return;
			settled = true;
			cleanup();
			sub.unsubscribe();
			reject(signal!.reason ?? new DOMException("The operation was aborted.", "AbortError"));
		}

		function cleanup() {
			signal?.removeEventListener("abort", onAbort);
		}

		signal?.addEventListener("abort", onAbort);
	});
}
