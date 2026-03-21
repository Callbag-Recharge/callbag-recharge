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

import { computed, getCurrentScope, onScopeDispose, type Ref, readonly, shallowRef } from "vue";
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
