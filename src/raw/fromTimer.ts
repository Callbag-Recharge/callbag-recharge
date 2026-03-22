// ---------------------------------------------------------------------------
// fromTimer — raw callbag source from setTimeout
// ---------------------------------------------------------------------------
// Returns a raw callbag source that emits `undefined` once after `ms`
// milliseconds, then sends END. No core primitives — pure callbag protocol.
// ---------------------------------------------------------------------------

import type { CallbagSource } from "./subscribe";

/**
 * Creates a raw callbag source that emits `undefined` once after a delay,
 * then completes (END). If the signal is already aborted or aborts during
 * the delay, emits immediately.
 *
 * Use with `firstValueFrom` to replace raw `new Promise` + `setTimeout`.
 *
 * @param ms - Delay in milliseconds.
 * @param signal - Optional AbortSignal to cancel the delay early.
 *
 * @returns A raw callbag source function.
 *
 * @category raw
 */
export function fromTimer(ms: number, signal?: AbortSignal): CallbagSource {
	return (type: number, sink?: any) => {
		if (type !== 0 /* START */) return;

		let done = false;

		function finish() {
			if (done) return;
			done = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			sink(1 /* DATA */, undefined);
			sink(2 /* END */);
		}

		function onAbort() {
			finish();
		}

		// Talkback: sink can send END to cancel
		sink(0 /* START */, (t: number) => {
			if (t === 2 /* END */ && !done) {
				done = true;
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
			}
		});

		if (signal?.aborted) {
			finish();
			return;
		}

		const timer = setTimeout(finish, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	};
}
