// ---------------------------------------------------------------------------
// Solid bindings — useSubscribe
// ---------------------------------------------------------------------------
// Bridges callbag-recharge stores into Solid reactivity via createSignal.
// Works with any Store<T>, including companion stores (ws.status, ws.error).
//
// Usage:
//   import { useSubscribe } from 'callbag-recharge/compat/solid';
//   const status = useSubscribe(ws.status);   // Accessor<string>
// ---------------------------------------------------------------------------

import { createSignal, getOwner, onCleanup } from "solid-js";
import { subscribe } from "../../core/subscribe";
import type { Store } from "../../core/types";

/** Solid accessor function — returns current value when called. */
export type Accessor<T> = () => T;

/**
 * Subscribe to a `Store<T>` as a Solid signal. Auto-cleans up with the owning scope.
 *
 * @param store - Any `Store<T>` (including companion stores like `ws.status`).
 *
 * @returns `Accessor<T>` — a Solid accessor that tracks the store's current value.
 *
 * @example
 * ```tsx
 * import { useSubscribe } from 'callbag-recharge/compat/solid';
 *
 * function StatusBadge(props) {
 *   const status = useSubscribe(props.ws.status);
 *   return <span>{status()}</span>;
 * }
 * ```
 *
 * @category compat/solid
 */
export function useSubscribe<T>(store: Store<T>): Accessor<T> {
	const [value, setValue] = createSignal(store.get(), { equals: false });

	const sub = subscribe(store, (v) => {
		setValue(() => v);
	});

	if (getOwner()) {
		onCleanup(() => sub.unsubscribe());
	} else if (typeof console !== "undefined") {
		console.warn(
			"[callbag-recharge] useSubscribe called outside a Solid reactive owner — subscription will not be auto-disposed.",
		);
	}

	return value;
}

/** Maps a key to an object of stores. Used by `useSubscribeRecord`. */
export type StoreFactory<K, R extends Record<string, any>> = (key: K) => {
	[P in keyof R]: Store<R[P]>;
};

/**
 * Subscribe to a dynamic set of keyed store records as a Solid accessor.
 * Re-subscribes all per-key fields whenever `keys` changes.
 *
 * @param keys - Store of current keys (e.g. node IDs).
 * @param factory - Function returning `{ [field]: Store<V> }` for each key.
 *
 * @returns `Accessor<Record<K, R>>` — accessor for current keyed snapshot.
 *
 * @category compat/solid
 */
export function useSubscribeRecord<K extends string, R extends Record<string, any>>(
	keys: Store<K[]>,
	factory: StoreFactory<K, R>,
): Accessor<Record<K, R>> {
	const [value, setValue] = createSignal({} as Record<K, R>, { equals: false });
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
					setValue(() => buildSnapshot());
				});
				entrySubs.push(sub);
			}
		}
		setValue(() => buildSnapshot());
	};

	const keysSub = subscribe(keys, sync);
	sync(keys.get());

	if (getOwner()) {
		onCleanup(() => {
			keysSub.unsubscribe();
			cleanupEntries();
		});
	} else if (typeof console !== "undefined") {
		console.warn(
			"[callbag-recharge] useSubscribeRecord called outside a Solid reactive owner — subscription will not be auto-disposed.",
		);
	}

	return value;
}
