// ---------------------------------------------------------------------------
// fromTimer — ProducerStore from setTimeout (wraps raw/fromTimer in producer)
// ---------------------------------------------------------------------------

import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";

/**
 * Creates a ProducerStore that emits `undefined` once after a delay,
 * then completes. If the signal is already aborted or aborts during the
 * delay, emits immediately.
 *
 * This is the store-level wrapper around the raw callbag `fromTimer`.
 * Use this when you need a full `ProducerStore` with lifecycle tracking.
 * Use `raw/fromTimer` + `rawSubscribe` for lightweight callbag-only delays.
 * Use `firstValueFrom` only at system boundaries when exiting callbag-land.
 *
 * @param ms - Delay in milliseconds.
 * @param signal - Optional AbortSignal to cancel the delay early.
 *
 * @returns `ProducerStore<void>` — emits once, completes.
 *
 * @category extra
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
