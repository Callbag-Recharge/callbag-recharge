/**
 * Core subscribe — reusable callbag sink connector.
 *
 * Used as the base for:
 * - External subscribe (extra/subscribe re-exports this)
 * - Derived's dep connections (STANDALONE mode)
 * - Effect's dep connections
 *
 * v4: Handles callbag START handshake, filters STATE for user callbacks,
 * provides prev-value tracking. Returns unsub function.
 */

import { beginDeferredStart, END, endDeferredStart, START } from "./protocol";
import type { Store } from "./types";

export function subscribe<T>(
	store: Store<T>,
	cb: (value: T, prev: T | undefined) => void,
	opts?: { onEnd?: (error?: unknown) => void },
): () => void {
	let talkback: ((type: number) => void) | null = null;

	beginDeferredStart();

	// `prev` is declared after store.source() but the closure only reads it
	// after endDeferredStart() triggers producers. By that point prev is already
	// set to store.get(). Order: register sink → read baseline → start producers.
	store.source(START, (type: number, data: any) => {
		if (type === START) talkback = data;
		if (type === END) {
			talkback = null;
			opts?.onEnd?.(data);
			return;
		}
		// Transparent sink — forwards every DATA to the callback.
		// Dedup (if desired) belongs in the source (state's equals) or in
		// an explicit operator (distinctUntilChanged), not here.
		if (type === 1 /* DATA */) {
			const next = data as T;
			const p = prev;
			prev = next;
			cb(next, p);
		}
	});

	// Baseline: captures current value before producers start. Aligns with
	// RxJS Observable semantics — no initial-value callback on subscribe.
	let prev: T | undefined = store.get();

	endDeferredStart();

	return () => talkback?.(END);
}
