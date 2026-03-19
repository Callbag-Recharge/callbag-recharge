/**
 * TC39 Signals-compatible API built on callbag-recharge primitives.
 *
 * Positions callbag-recharge as a Signals polyfill with bonus features
 * (batching, diamond resolution, operators). Follows the TC39 proposal API.
 *
 * Note: `Signal.Computed` requires an explicit `deps` array as a second
 * argument, since callbag-recharge uses explicit deps (not auto-tracking).
 *
 * @category compat
 */

import { derived } from "../../core/derived";
import { effect } from "../../core/effect";
import { batch } from "../../core/protocol";
import { state } from "../../core/state";
import { subscribe as coreSubscribe } from "../../core/subscribe";
import type { Store, WritableStore } from "../../core/types";

// ---------------------------------------------------------------------------
// Signal.State
// ---------------------------------------------------------------------------

/**
 * TC39 `Signal.State` — a writable signal backed by `state()`.
 *
 * @example
 * ```ts
 * import { Signal } from 'callbag-recharge/compat/signals';
 *
 * const count = new Signal.State(0);
 * count.get(); // 0
 * count.set(1);
 * count.get(); // 1
 * ```
 */
class SignalState<T> {
	/** @internal */
	_store: WritableStore<T>;

	constructor(initial: T, opts?: { equals?: (a: T, b: T) => boolean }) {
		this._store = state<T>(initial, { equals: opts?.equals });
	}

	get(): T {
		return this._store.get();
	}

	set(value: T): void {
		this._store.set(value);
	}
}

// ---------------------------------------------------------------------------
// Signal.Computed
// ---------------------------------------------------------------------------

/**
 * TC39 `Signal.Computed` — a read-only computed signal backed by `derived()`.
 *
 * Requires an explicit `deps` array (callbag-recharge uses explicit deps,
 * not auto-tracking). This diverges from the TC39 spec which auto-tracks.
 *
 * @example
 * ```ts
 * import { Signal } from 'callbag-recharge/compat/signals';
 *
 * const count = new Signal.State(0);
 * const doubled = new Signal.Computed(() => count.get() * 2, [count]);
 * doubled.get(); // 0
 * count.set(3);
 * doubled.get(); // 6
 * ```
 */
class SignalComputed<T> {
	/** @internal */
	_store: Store<T>;

	constructor(
		fn: () => T,
		deps: Array<SignalState<any> | SignalComputed<any>>,
		opts?: { equals?: (a: T, b: T) => boolean },
	) {
		const storeDeps: Store<unknown>[] = deps.map((d) => d._store);
		this._store = derived(storeDeps, fn, { equals: opts?.equals });
	}

	get(): T {
		return this._store.get();
	}
}

// ---------------------------------------------------------------------------
// Signal.subtle.Watcher
// ---------------------------------------------------------------------------

/**
 * TC39 `Signal.subtle.Watcher` — watches signals for changes.
 *
 * `getPending()` returns signals that changed since the last notify call,
 * enabling batched reads. Automatically cleans up entries when a watched
 * signal's store completes.
 *
 * @example
 * ```ts
 * import { Signal } from 'callbag-recharge/compat/signals';
 *
 * const count = new Signal.State(0);
 * const watcher = new Signal.subtle.Watcher(() => {
 *   console.log('something changed');
 * });
 * watcher.watch(count);
 * count.set(1); // logs 'something changed'
 * watcher.unwatch(count);
 * ```
 */
class SignalWatcher {
	private _notify: () => void;
	private _unsubs = new Map<SignalState<any> | SignalComputed<any>, () => void>();
	private _pending = new Set<SignalState<any> | SignalComputed<any>>();

	constructor(notify: () => void) {
		this._notify = notify;
	}

	watch(...signals: Array<SignalState<any> | SignalComputed<any>>): void {
		for (const signal of signals) {
			if (this._unsubs.has(signal)) continue;
			const unsub = coreSubscribe(
				signal._store,
				() => {
					this._pending.add(signal);
					this._notify();
				},
				{
					onEnd: () => {
						// Auto-cleanup when the store completes/errors
						this._unsubs.delete(signal);
						this._pending.delete(signal);
					},
				},
			);
			this._unsubs.set(signal, unsub);
		}
	}

	unwatch(...signals: Array<SignalState<any> | SignalComputed<any>>): void {
		for (const signal of signals) {
			const unsub = this._unsubs.get(signal);
			if (unsub) {
				unsub();
				this._unsubs.delete(signal);
				this._pending.delete(signal);
			}
		}
	}

	/**
	 * Returns signals that have changed since the last `getPending()` call.
	 * Clears the pending set after reading, matching TC39 Watcher semantics.
	 */
	getPending(): Array<SignalState<any> | SignalComputed<any>> {
		const result = [...this._pending];
		this._pending.clear();
		return result;
	}
}

// ---------------------------------------------------------------------------
// Signal namespace
// ---------------------------------------------------------------------------

/**
 * TC39 Signals-compatible namespace. Wraps callbag-recharge primitives.
 *
 * @example
 * ```ts
 * import { Signal } from 'callbag-recharge/compat/signals';
 *
 * const a = new Signal.State(1);
 * const b = new Signal.Computed(() => a.get() * 2, [a]);
 * b.get(); // 2
 * ```
 *
 * @category compat
 */
export const Signal = {
	State: SignalState,
	Computed: SignalComputed,
	subtle: {
		Watcher: SignalWatcher,
		untrack: <T>(fn: () => T): T => fn(),
	},
} as const;

export type { SignalComputed, SignalState, SignalWatcher };

// Re-export batch as a bonus feature
export { batch };

// ---------------------------------------------------------------------------
// Helpers: effect wrapper
// ---------------------------------------------------------------------------

/**
 * Create a reactive effect that runs when any watched signals change.
 * Bonus feature not in TC39 spec — bridges to callbag-recharge's `effect()`.
 */
export function signalEffect(
	deps: Array<SignalState<any> | SignalComputed<any>>,
	fn: () => undefined | (() => void),
): () => void {
	return effect(
		deps.map((d) => d._store),
		fn,
	);
}
