// ---------------------------------------------------------------------------
// React bindings — useStore / useSubscribe
// ---------------------------------------------------------------------------
// Bridges callbag-recharge stores into React via useSyncExternalStore.
// Works with any Store<T>, including companion stores (ws.status, ws.error).
//
// Usage:
//   import { useStore, useSubscribe } from 'callbag-recharge/compat/react';
//   const value = useSubscribe(myStore);           // T (read-only)
//   const [count, setCount] = useStore(counter);   // [T, setter]
// ---------------------------------------------------------------------------

import { useCallback, useSyncExternalStore } from "react";
import { subscribe } from "../../core/subscribe";
import type { Store, WritableStore } from "../../core/types";

/**
 * Subscribe to a read-only `Store<T>` as a React value. Re-renders on each emission.
 *
 * @param store - Any `Store<T>` (including companion stores like `ws.status`).
 *
 * @returns `T` — the current store value, kept in sync via `useSyncExternalStore`.
 *
 * @example
 * ```ts
 * import { useSubscribe } from 'callbag-recharge/compat/react';
 *
 * function StatusBadge({ ws }) {
 *   const status = useSubscribe(ws.status);
 *   return <span>{status}</span>;
 * }
 * ```
 *
 * @category compat/react
 */
export function useSubscribe<T>(store: Store<T>): T {
	return useSyncExternalStore(
		(onStoreChange) => {
			let disposed = false;

			const sub = subscribe(store, () => {
				if (!disposed) onStoreChange();
			});

			return () => {
				disposed = true;
				sub.unsubscribe();
			};
		},
		() => store.get(),
	);
}

/**
 * Bind a writable `WritableStore<T>` as a React `[value, setter]` tuple.
 *
 * @param store - A `WritableStore<T>` (e.g. from `state()`).
 *
 * @returns `[T, (value: T) => void]` — current value and setter function.
 *
 * @example
 * ```ts
 * import { useStore } from 'callbag-recharge/compat/react';
 *
 * function Counter({ store }) {
 *   const [count, setCount] = useStore(store);
 *   return <button onClick={() => setCount(count + 1)}>{count}</button>;
 * }
 * ```
 *
 * @category compat/react
 */
export function useStore<T>(store: WritableStore<T>): [T, (value: T) => void] {
	const value = useSubscribe(store);
	const setter = useCallback((v: T) => store.set(v), [store]);
	return [value, setter];
}

/** Maps a key to an object of stores. Used by `useSubscribeRecord`. */
export type StoreFactory<K, R extends Record<string, any>> = (key: K) => {
	[P in keyof R]: Store<R[P]>;
};

/**
 * Subscribe to a dynamic set of keyed store records.
 * Re-subscribes all per-key fields whenever `keys` changes.
 *
 * @param keys - Store of current keys (e.g. node IDs).
 * @param factory - Function returning `{ [field]: Store<V> }` for each key.
 *
 * @returns `Record<K, R>` — snapshot of resolved values for all keys.
 *
 * @category compat/react
 */
export function useSubscribeRecord<K extends string, R extends Record<string, any>>(
	keys: Store<K[]>,
	factory: StoreFactory<K, R>,
): Record<K, R> {
	return useSyncExternalStore(
		(onStoreChange) => {
			let disposed = false;
			let entrySubs: Array<{ unsubscribe: () => void }> = [];

			const cleanupEntries = () => {
				for (const sub of entrySubs) sub.unsubscribe();
				entrySubs = [];
			};

			const sync = (nextKeys: K[]) => {
				cleanupEntries();
				for (const key of nextKeys) {
					const stores = factory(key);
					for (const field of Object.keys(stores) as (keyof R)[]) {
						const sub = subscribe(stores[field], () => {
							if (!disposed) onStoreChange();
						});
						entrySubs.push(sub);
					}
				}
				if (!disposed) onStoreChange();
			};

			const keysSub = subscribe(keys, sync);
			sync(keys.get());

			return () => {
				disposed = true;
				keysSub.unsubscribe();
				cleanupEntries();
			};
		},
		() => {
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
		},
	);
}
