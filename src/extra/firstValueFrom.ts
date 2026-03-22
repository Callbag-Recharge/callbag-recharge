// ---------------------------------------------------------------------------
// firstValueFrom (Store-aware) — wraps raw/firstValueFrom with .get() fast path
// ---------------------------------------------------------------------------

import type { Store } from "../core/types";
import { firstValueFrom as rawFirstValueFrom } from "../raw/firstValueFrom";

/**
 * Store-aware version of `firstValueFrom`. Checks the store's current value
 * via `.get()` before subscribing — needed because state stores don't re-emit
 * on subscribe.
 *
 * Use `raw/firstValueFrom` for raw callbag sources.
 * Use this for Store objects.
 *
 * @param store - A `Store<T>` to observe.
 * @param predicate - Optional filter. If omitted, resolves with the current or first emitted value.
 *
 * @returns Promise that resolves with the matching value, or rejects if
 *          the source completes (END) without a match.
 *
 * @category extra
 */
export function firstValueFrom<T>(store: Store<T>, predicate?: (value: T) => boolean): Promise<T> {
	// Fast path: check current value before subscribing
	try {
		const current = store.get();
		if (!predicate || predicate(current)) {
			return Promise.resolve(current);
		}
	} catch (_) {
		// Store may error on get() — fall through to subscribe
	}

	return rawFirstValueFrom<T>(store.source, predicate);
}
