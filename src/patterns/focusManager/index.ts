// ---------------------------------------------------------------------------
// focusManager — reactive focus/activation tracking
// ---------------------------------------------------------------------------
// Reactive focus tracking for a set of identifiable elements. Supports
// ordered traversal (next/prev), dynamic registration, and per-ID reactive
// isFocused stores.
//
// Built on: state, derived
// ---------------------------------------------------------------------------

import { derived } from "../../core/derived";
import { teardown } from "../../core/protocol";
import { state } from "../../core/state";
import type { Store } from "../../core/types";

export interface FocusManagerOptions {
	/** Initial focused ID. Default: null */
	initial?: string | null;
	/** Whether focus wraps around at boundaries. Default: true */
	wrap?: boolean;
	/** Debug name prefix. */
	name?: string;
}

export interface FocusManagerResult {
	/** Currently focused ID (null if nothing focused). */
	active: Store<string | null>;
	/** Whether any element is focused. */
	hasFocus: Store<boolean>;

	/** Focus a specific element by ID. */
	focus(id: string): void;
	/** Blur — remove focus from all elements. */
	blur(): void;
	/** Focus the next element in registration order. */
	next(): void;
	/** Focus the previous element in registration order. */
	prev(): void;
	/** Register a focusable ID. */
	register(id: string): void;
	/** Unregister a focusable ID. Blurs if it was focused. */
	unregister(id: string): void;

	/** Reactive store for whether a specific ID is focused. Cached per ID. */
	isFocused(id: string): Store<boolean>;

	/** Dispose — clears all state. */
	dispose(): void;
}

/**
 * Creates a reactive focus manager for ordered, identifiable elements.
 *
 * @param ids - Initial set of focusable IDs (in order).
 * @param opts - Optional configuration.
 *
 * @returns `FocusManagerResult` — reactive active/hasFocus stores + navigation methods.
 *
 * @remarks **Ordered traversal:** `next()`/`prev()` follow registration order.
 * @remarks **Wrap:** By default, next() at the end wraps to the beginning (and vice versa).
 * @remarks **Dynamic registration:** `register()`/`unregister()` update the focusable set.
 * @remarks **Per-ID reactivity:** `isFocused(id)` returns a cached derived store.
 *
 * @example
 * ```ts
 * import { focusManager } from 'callbag-recharge/patterns/focusManager';
 *
 * const fm = focusManager(['tab1', 'tab2', 'tab3']);
 * fm.focus('tab1');
 * fm.active.get(); // 'tab1'
 * fm.next();
 * fm.active.get(); // 'tab2'
 * fm.isFocused('tab2').get(); // true
 * ```
 *
 * @category patterns
 */
export function focusManager(ids: string[] = [], opts?: FocusManagerOptions): FocusManagerResult {
	const wrap = opts?.wrap ?? true;
	const prefix = opts?.name ?? "focusManager";

	// Ordered list of focusable IDs — reactive store so register/unregister
	// flow through the graph instead of mutating a flat array.
	const _idsStore = state<string[]>([...ids], { name: `${prefix}.ids` });

	const initialId = opts?.initial ?? null;
	const activeStore = state<string | null>(
		initialId !== null && ids.includes(initialId) ? initialId : null,
		{ name: `${prefix}.active` },
	);

	const hasFocus = derived([activeStore], () => activeStore.get() !== null, {
		name: `${prefix}.hasFocus`,
	});

	// Cached isFocused stores
	const _focusedCache = new Map<string, Store<boolean>>();

	let disposed = false;

	function focus(id: string): void {
		if (disposed) return;
		if (!_idsStore.get().includes(id)) return;
		activeStore.set(id);
	}

	function blur(): void {
		if (disposed) return;
		activeStore.set(null);
	}

	function next(): void {
		if (disposed) return;
		const _ids = _idsStore.get();
		if (_ids.length === 0) return;

		const current = activeStore.get();
		if (current === null) {
			activeStore.set(_ids[0]);
			return;
		}

		const idx = _ids.indexOf(current);
		if (idx === -1) {
			activeStore.set(_ids[0]);
			return;
		}

		if (idx < _ids.length - 1) {
			activeStore.set(_ids[idx + 1]);
		} else if (wrap) {
			activeStore.set(_ids[0]);
		}
	}

	function prev(): void {
		if (disposed) return;
		const _ids = _idsStore.get();
		if (_ids.length === 0) return;

		const current = activeStore.get();
		if (current === null) {
			activeStore.set(_ids[_ids.length - 1]);
			return;
		}

		const idx = _ids.indexOf(current);
		if (idx === -1) {
			activeStore.set(_ids[_ids.length - 1]);
			return;
		}

		if (idx > 0) {
			activeStore.set(_ids[idx - 1]);
		} else if (wrap) {
			activeStore.set(_ids[_ids.length - 1]);
		}
	}

	function register(id: string): void {
		if (disposed) return;
		const _ids = _idsStore.get();
		if (_ids.includes(id)) return;
		_idsStore.set([..._ids, id]);
	}

	function unregister(id: string): void {
		if (disposed) return;
		const _ids = _idsStore.get();
		const idx = _ids.indexOf(id);
		if (idx === -1) return;
		_idsStore.set(_ids.filter((x) => x !== id));
		// Blur if the unregistered element was focused
		if (activeStore.get() === id) {
			activeStore.set(null);
		}
		// Clean up cached isFocused store
		_focusedCache.delete(id);
	}

	function isFocused(id: string): Store<boolean> {
		let cached = _focusedCache.get(id);
		if (cached) return cached;
		cached = derived([activeStore], () => activeStore.get() === id, {
			name: `${prefix}.isFocused(${id})`,
		});
		_focusedCache.set(id, cached);
		return cached;
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		// Reset state before teardown so get() returns clean values
		activeStore.set(null);
		_idsStore.set([]);
		// Teardown stores — cascades END to hasFocus and all cached
		// isFocused derived stores through the graph.
		teardown(activeStore);
		teardown(_idsStore);
		_focusedCache.clear();
	}

	return {
		active: activeStore,
		hasFocus,
		focus,
		blur,
		next,
		prev,
		register,
		unregister,
		isFocused,
		dispose,
	};
}
