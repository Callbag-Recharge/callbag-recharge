// ---------------------------------------------------------------------------
// fromTimer — callbag source from setTimeout
// ---------------------------------------------------------------------------
// Creates a producer store that emits once after `ms` milliseconds, then
// completes. Respects an optional AbortSignal — emits immediately on abort.
// ---------------------------------------------------------------------------

import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";

/**
 * Creates a callbag source that emits `undefined` once after a delay,
 * then completes. If the signal is already aborted or aborts during the
 * delay, emits immediately.
 *
 * Use with `firstValueFrom` to replace raw `new Promise` + `setTimeout`.
 *
 * @param ms - Delay in milliseconds.
 * @param signal - Optional AbortSignal to cancel the delay early.
 *
 * @returns `ProducerStore<void>` — emits once, completes.
 *
 * @category raw
 */
export function fromTimer(ms: number, signal?: AbortSignal): ProducerStore<void> {
	return producer<void>(({ emit, complete }) => {
		if (signal?.aborted) {
			emit(undefined as undefined);
			complete();
			return;
		}

		let done = false;

		const timer = setTimeout(() => {
			if (done) return;
			done = true;
			cleanup();
			emit(undefined as undefined);
			complete();
		}, ms);

		function onAbort() {
			if (done) return;
			done = true;
			clearTimeout(timer);
			emit(undefined as undefined);
			complete();
		}

		signal?.addEventListener("abort", onAbort, { once: true });

		function cleanup() {
			signal?.removeEventListener("abort", onAbort);
		}

		return () => {
			if (!done) {
				done = true;
				clearTimeout(timer);
				cleanup();
			}
		};
	});
}
