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

/** Maps a key to an object of stores. Used by `useSubscribeRecord`. */
export type StoreFactory<K, R extends Record<string, any>> = (key: K) => {
	[P in keyof R]: Store<R[P]>;
};

/**
 * Subscribe to a dynamic keyed record of stores as a Svelte readable store.
 * Re-subscribes all per-key fields whenever `keys` changes.
 *
 * @param keys - Store of current keys (e.g. node IDs).
 * @param factory - Function returning `{ [field]: Store<V> }` for each key.
 *
 * @returns `SvelteReadable<Record<K, R>>` — Svelte-readable keyed snapshot.
 *
 * @category compat/svelte
 */
export function useSubscribeRecord<K extends string, R extends Record<string, any>>(
	keys: Store<K[]>,
	factory: StoreFactory<K, R>,
): SvelteReadable<Record<K, R>> {
	return {
		subscribe(run: (value: Record<K, R>) => void): () => void {
			let entrySubs: Array<{ unsubscribe: () => void }> = [];

			const cleanupEntries = () => {
				for (const sub of entrySubs) sub.unsubscribe();
				entrySubs = [];
			};

			const buildSnapshot = (): Record<K, R> => {
				const snap = {} as Record<K, R>;
				for (const key of keys.get()) {
					const stores = factory(key);
					const values = {} as R;
					for (const field of Object.keys(stores) as (keyof R)[]) {
						values[field] = stores[field].get();
					}
					snap[key] = values;
				}
				return snap;
			};

			const sync = (nextKeys: K[]) => {
				cleanupEntries();
				for (const key of nextKeys) {
					const stores = factory(key);
					for (const field of Object.keys(stores) as (keyof R)[]) {
						const sub = subscribe(stores[field], () => {
							run(buildSnapshot());
						});
						entrySubs.push(sub);
					}
				}
				run(buildSnapshot());
			};

			const keysSub = subscribe(keys, sync);
			sync(keys.get());

			return () => {
				keysSub.unsubscribe();
				cleanupEntries();
			};
		},
	};
}
