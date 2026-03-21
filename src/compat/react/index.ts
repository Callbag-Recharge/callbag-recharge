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

			const unsub = subscribe(store, () => {
				if (!disposed) onStoreChange();
			});

			return () => {
				disposed = true;
				unsub();
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
