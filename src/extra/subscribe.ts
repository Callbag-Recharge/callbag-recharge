/**
 * Listens to value changes with previous-value tracking.
 * Returns an unsubscribe function.
 *
 * Stateless: does not produce a store. Pure callbag sink.
 *
 * v3: receives type 1 DATA only — no DIRTY awareness. Type 3 signals are
 * ignored (subscribe doesn't participate in state management).
 */

import { beginDeferredStart, END, endDeferredStart, START } from "../protocol";
import type { Store } from "../types";

export function subscribe<T>(
	store: Store<T>,
	cb: (value: T, prev: T | undefined) => void,
): () => void {
	let talkback: ((type: number) => void) | null = null;

	beginDeferredStart();

	// `prev` is declared after store.source() but the closure only reads it
	// after endDeferredStart() triggers producers. By that point prev is already
	// set to store.get(), so the first emission is suppressed if the value
	// hasn't changed. Order: register sink → read baseline → start producers.
	store.source(START, (type: number, data: any) => {
		if (type === START) talkback = data;
		if (type === END) {
			talkback = null;
			return;
		}
		// Equality check suppresses duplicate emissions (e.g. a batch that
		// coalesced multiple set() calls back to the original value).
		if (type === 1 /* DATA */) {
			const next = data as T;
			if (!Object.is(next, prev)) {
				const p = prev;
				prev = next;
				cb(next, p);
			}
		}
	});

	// Baseline: captures current value before producers start. Aligns with
	// RxJS Observable semantics — no initial-value callback on subscribe.
	// (Unlike Svelte stores, which call subscribers immediately with the
	// current value. Our callbag convention: reactive changes only.)
	let prev: T | undefined = store.get();

	endDeferredStart();

	return () => talkback?.(END);
}
