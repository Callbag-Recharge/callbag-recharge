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

	const unsub = subscribe(store, (v) => {
		setValue(() => v);
	});

	if (getOwner()) {
		onCleanup(unsub);
	} else if (typeof console !== "undefined") {
		console.warn(
			"[callbag-recharge] useSubscribe called outside a Solid reactive owner — subscription will not be auto-disposed.",
		);
	}

	return value;
}
