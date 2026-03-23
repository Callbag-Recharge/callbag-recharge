// ---------------------------------------------------------------------------
// Vue bindings — useStore / useSubscribe
// ---------------------------------------------------------------------------
// Bridges callbag-recharge stores into Vue reactivity. Works with any
// Store<T>, including companion stores (ws.status, ws.error).
//
// Usage:
//   import { useStore, useSubscribe } from 'callbag-recharge/compat/vue';
//   const count = useStore(counterStore);       // Ref<number> (read + write)
//   const status = useSubscribe(ws.status);     // Readonly<Ref<string>>
// ---------------------------------------------------------------------------

import {
	computed,
	getCurrentScope,
	onScopeDispose,
	type Ref,
	readonly,
	shallowRef,
	type WatchSource,
	watch,
} from "vue";
import type { Subscription } from "../../core/protocol";
import { subscribe } from "../../core/subscribe";
import type { Store, WritableStore } from "../../core/types";

/**
 * Subscribe to a read-only `Store<T>` as a Vue `Ref<T>`. Auto-unsubscribes on scope disposal.
 *
 * @param store - Any `Store<T>` (including companion stores like `ws.status`).
 *
 * @returns `Readonly<Ref<T>>` — reactive ref that updates when the store emits.
 *
 * @example
 * ```ts
 * import { useSubscribe } from 'callbag-recharge/compat/vue';
 *
 * const status = useSubscribe(ws.status);
 * // Use in template: {{ status }}
 * ```
 *
 * @category compat/vue
 */
export function useSubscribe<T>(store: Store<T>): Readonly<Ref<T>> {
	const ref = shallowRef(store.get()) as Ref<T>;

	const sub = subscribe(store, (value) => {
		ref.value = value;
	});

	if (getCurrentScope()) {
		onScopeDispose(() => sub.unsubscribe());
	} else if (typeof console !== "undefined") {
		console.warn(
			"[callbag-recharge] useSubscribe called outside a Vue scope — subscription will not be auto-disposed.",
		);
	}

	return readonly(ref) as Readonly<Ref<T>>;
}

/**
 * Bind a writable `WritableStore<T>` as a Vue `Ref<T>`. Reads and writes are bidirectional.
 *
 * @param store - A `WritableStore<T>` (e.g. from `state()`).
 *
 * @returns `Ref<T>` — writable ref. Setting the ref calls `store.set()`.
 *
 * @example
 * ```ts
 * import { useStore } from 'callbag-recharge/compat/vue';
 *
 * const count = useStore(counterStore);
 * count.value++; // calls counterStore.set()
 * ```
 *
 * @category compat/vue
 */
export function useStore<T>(store: WritableStore<T>): Ref<T> {
	const inner = shallowRef(store.get()) as Ref<T>;

	const sub = subscribe(store, (value) => {
		inner.value = value;
	});

	if (getCurrentScope()) {
		onScopeDispose(() => sub.unsubscribe());
	} else if (typeof console !== "undefined") {
		console.warn(
			"[callbag-recharge] useStore called outside a Vue scope — subscription will not be auto-disposed.",
		);
	}

	return computed({
		get: () => inner.value,
		set: (v: T) => store.set(v),
	}) as Ref<T>;
}

// ---------------------------------------------------------------------------
// useSubscribeRecord — dynamic per-key store subscriptions
// ---------------------------------------------------------------------------

/** Maps a key to an object of stores. Used by `useSubscribeRecord` factory. */
export type StoreFactory<K, R extends Record<string, any>> = (key: K) => {
	[P in keyof R]: Store<R[P]>;
};

/**
 * Subscribe to a dynamic set of keyed store records. When keys change,
 * old subscriptions are torn down and new ones created automatically.
 *
 * Solves the common pattern of rendering a list where each item owns
 * multiple reactive stores (e.g., DAG nodes with status + breaker + log).
 *
 * Must be called during Vue `setup()`.
 *
 * @param keys - Reactive source of current keys (e.g., node IDs).
 * @param factory - Function that returns a `{ [field]: Store<V> }` object per key.
 *
 * @returns `Readonly<Ref<Record<K, R>>>` — reactive record of resolved values.
 *
 * @example
 * ```ts
 * const nodes = useSubscribe(wb.nodes); // Ref<WorkflowNode[]>
 * const nodeData = useSubscribeRecord(
 *   () => nodes.value.map(n => n.id),
 *   (id) => {
 *     const n = nodes.value.find(n => n.id === id)!;
 *     return { status: n.task.status, breaker: n.breakerState };
 *   },
 * );
 * // Template: {{ nodeData["extract"].status }}
 * ```
 *
 * @category compat/vue
 */
export function useSubscribeRecord<K extends string, R extends Record<string, any>>(
	keys: WatchSource<K[]>,
	factory: StoreFactory<K, R>,
): Readonly<Ref<Record<K, R>>> {
	const result = shallowRef<Record<K, R>>({} as Record<K, R>);

	// Track active subscriptions per key
	const activeSubs = new Map<K, { subs: Subscription[]; values: R }>();

	// Batched reactivity trigger — coalesce multiple field updates into one ref write
	let batchPending = false;
	function scheduleBatch() {
		if (batchPending) return;
		batchPending = true;
		queueMicrotask(() => {
			batchPending = false;
			const snap = {} as Record<K, R>;
			for (const [key, entry] of activeSubs) {
				snap[key] = { ...entry.values };
			}
			result.value = snap;
		});
	}

	function sync(newKeys: K[]) {
		// Always tear down ALL existing subscriptions (P3: avoids stale factory closures)
		for (const entry of activeSubs.values()) {
			for (const sub of entry.subs) sub.unsubscribe();
		}
		activeSubs.clear();

		// Subscribe all current keys fresh
		for (const key of newKeys) {
			const stores = factory(key);
			const fields = Object.keys(stores) as (keyof R)[];
			const values = {} as R;
			const subs: Subscription[] = [];

			for (const field of fields) {
				const store = stores[field];
				values[field] = store.get();
				const sub = subscribe(store, (v) => {
					values[field] = v;
					scheduleBatch();
				});
				subs.push(sub);
			}

			activeSubs.set(key, { subs, values });
		}

		// Immediate snapshot (don't wait for microtask on key changes)
		const snap = {} as Record<K, R>;
		for (const [key, entry] of activeSubs) {
			snap[key] = { ...entry.values };
		}
		result.value = snap;
	}

	// Watch for key changes
	watch(keys, (newKeys) => sync(newKeys), { immediate: true });

	// Cleanup all on scope disposal
	if (getCurrentScope()) {
		onScopeDispose(() => {
			for (const entry of activeSubs.values()) {
				for (const sub of entry.subs) sub.unsubscribe();
			}
			activeSubs.clear();
		});
	}

	return readonly(result) as Readonly<Ref<Record<K, R>>>;
}
