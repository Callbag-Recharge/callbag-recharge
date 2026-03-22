/**
 * Core subscribe — Store-aware callbag sink built on raw/subscribe.
 *
 * Used as the base for:
 * - External subscribe (extra/subscribe re-exports this)
 * - Internal wiring in tier 2 operators, orchestrate, etc.
 *
 * Adds on top of raw/subscribe:
 * - Store.get() baseline for prev tracking
 * - beginDeferredStart / endDeferredStart for connection batching
 * - signal() for upstream lifecycle control via talkback
 */

import type { LifecycleSignal, Subscription } from "./protocol";
import { beginDeferredStart, END, endDeferredStart, START, STATE } from "./protocol";
import type { Store } from "./types";

/**
 * Subscribes to a store's DATA emissions with previous-value tracking.
 * Returns a Subscription with `unsubscribe()` and `signal()` for upstream lifecycle control.
 *
 * @param store - The `Store<T>` to listen to.
 * @param cb - Called with `(nextValue, previousValue)` on each DATA after subscribe.
 * @param opts - Optional `onEnd` when the stream completes or errors.
 *
 * @returns `Subscription` — `unsubscribe()` to disconnect, `signal(s)` to send lifecycle signals upstream.
 *
 * @example
 * ```ts
 * import { state, subscribe, RESET } from 'callbag-recharge';
 *
 * const n = state(0);
 * const sub = subscribe(n, (v, prev) => console.log(v));
 * n.set(1);
 * sub.signal(RESET);    // send RESET upstream
 * sub.unsubscribe();    // disconnect
 * ```
 *
 * @seeAlso [effect](./effect), [forEach](/api/forEach) — simpler value-only subscription
 */
export function subscribe<T>(
	store: Store<T>,
	cb: (value: T, prev: T | undefined) => void,
	opts?: { onEnd?: (error?: unknown) => void },
): Subscription {
	let talkback: ((type: number, data?: any) => void) | null = null;

	beginDeferredStart();

	// We need direct access to talkback for signal(), so we use the raw
	// callbag protocol directly rather than rawSubscribe — but the DATA/END
	// handling follows the same pattern as rawSubscribe.
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

	return {
		unsubscribe() {
			talkback?.(END);
			talkback = null;
		},
		signal(s: LifecycleSignal) {
			talkback?.(STATE, s);
		},
	};
}
