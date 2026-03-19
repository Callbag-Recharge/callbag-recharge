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

/**
 * Subscribes to a store’s DATA emissions with previous-value tracking. Returns an unsubscribe function.
 * Does not invoke the callback for the current value at subscribe time (Rx-style); only subsequent changes.
 *
 * @param store - The `Store<T>` to listen to.
 * @param cb - Called with `(nextValue, previousValue)` on each DATA after subscribe.
 * @param opts - Optional `onEnd` when the stream completes or errors.
 *
 * @returns `() => void` — call to unsubscribe (sends END on talkback).
 *
 * @remarks **Deferred start:** Works with `beginDeferredStart` / `endDeferredStart` batching used internally.
 *
 * @example
 * ```ts
 * import { state, subscribe } from 'callbag-recharge';
 *
 * const n = state(0);
 * const stop = subscribe(n, (v, prev) => {
 *   // prev is undefined on first emission after subscribe
 * });
 * n.set(1);
 * stop();
 * ```
 *
 * @seeAlso [effect](./effect), [forEach](/api/forEach) — simpler value-only subscription
 */
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
	let prev: T | undefined;
	try {
		prev = store.get();
	} catch (_) {
		// Store may have errored during source() — baseline is undefined
	}

	endDeferredStart();

	return () => talkback?.(END);
}
