// ---------------------------------------------------------------------------
// Svelte bindings — useSubscribe
// ---------------------------------------------------------------------------
// Bridges callbag-recharge stores into Svelte's store contract. Works with any
// Store<T>, including companion stores (ws.status, ws.error).
//
// Usage:
//   import { useSubscribe } from 'callbag-recharge/compat/svelte';
//   const status = useSubscribe(ws.status);   // Svelte readable store
//   // In template: $status
// ---------------------------------------------------------------------------

import { subscribe } from "../../core/subscribe";
import type { Store } from "../../core/types";

/** Svelte store contract — implements the minimal `subscribe` method. */
export interface SvelteReadable<T> {
	subscribe(run: (value: T) => void): () => void;
}

/**
 * Subscribe to a `Store<T>` as a Svelte readable store (implements Svelte store contract).
 *
 * @param store - Any `Store<T>` (including companion stores like `ws.status`).
 *
 * @returns `SvelteReadable<T>` — Svelte-compatible store that can be used with `$` syntax.
 *
 * @example
 * ```svelte
 * <script>
 *   import { useSubscribe } from 'callbag-recharge/compat/svelte';
 *   import { counterStore } from './stores';
 *
 *   const count = useSubscribe(counterStore);
 * </script>
 *
 * <p>{$count}</p>
 * ```
 *
 * @category compat/svelte
 */
export function useSubscribe<T>(store: Store<T>): SvelteReadable<T> {
	return {
		subscribe(run: (value: T) => void): () => void {
			// Subscribe first, then seed — avoids double-emission if a producer
			// fires synchronously during endDeferredStart, and ensures the unsub
			// handle exists before `run` executes.
			const sub = subscribe(store, (value) => {
				run(value);
			});
			// Svelte store contract: call `run` immediately with the current value
			try {
				run(store.get());
			} catch (_) {
				// Store may be in errored state — mirror core/subscribe resilience
			}
			return () => sub.unsubscribe();
		},
	};
}
