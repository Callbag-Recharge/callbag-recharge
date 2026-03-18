/**
 * A writable store, subclass of ProducerImpl.
 * Adds set()/update() API and defaults equals to Object.is.
 *
 * v5: _status packed into _flags bits 7-9 (inherited from ProducerImpl).
 * set() fast path uses pre-shifted status constants for zero-overhead writes.
 */

import { Inspector } from "./inspector";
import {
	_S_DIRTY,
	_S_SETTLED,
	_STATUS_MASK,
	P_AUTO_DIRTY,
	P_COMPLETED,
	P_PENDING,
	P_SKIP_DIRTY,
	ProducerImpl,
} from "./producer";
import { DATA, DIRTY, deferEmission, isBatching, STATE } from "./protocol";
import type { StoreOptions, WritableStore } from "./types";

export class StateImpl<T> extends ProducerImpl<T> {
	constructor(initial: T, opts?: StoreOptions<T>) {
		super(undefined, {
			initial,
			autoDirty: true,
			equals: opts?.equals ?? Object.is,
			_skipInspect: true,
		});
		this.set = this.set.bind(this);
		Inspector.register(this as any, { kind: "state", ...opts });
	}

	override get(): T {
		return this._value as T;
	}

	/**
	 * Fast path: inlines ProducerImpl.emit() to skip the bound method call.
	 * For no-subscriber writes, this is just an equals check + value assign.
	 * Status writes use pre-shifted integer constants (bits 7-9 of _flags).
	 */
	set(value: T): void {
		if (this._flags & P_COMPLETED) return;
		if (this._value !== undefined && this._eqFn!(this._value as T, value)) return;
		this._value = value;
		if (!this._output) return;
		if (isBatching()) {
			if (!(this._flags & P_PENDING)) {
				this._flags |= P_PENDING;
				if (this._flags & P_AUTO_DIRTY) {
					this._flags = (this._flags & ~_STATUS_MASK) | _S_DIRTY;
					this._dispatch(STATE, DIRTY);
				}
				deferEmission(() => {
					this._flags &= ~P_PENDING;
					this._flags = (this._flags & ~_STATUS_MASK) | _S_SETTLED;
					this._dispatch(DATA, this._value);
				});
			}
		} else {
			if (this._flags & P_AUTO_DIRTY && !(this._flags & P_SKIP_DIRTY)) {
				this._flags = (this._flags & ~_STATUS_MASK) | _S_DIRTY;
				this._dispatch(STATE, DIRTY);
			}
			this._flags = (this._flags & ~_STATUS_MASK) | _S_SETTLED;
			this._dispatch(DATA, this._value);
		}
	}

	update(fn: (current: T) => T): void {
		this.set(fn(this._value as T));
	}
}

/**
 * Creates a writable reactive store with an initial value and optional equality check.
 *
 * @param initial - The initial value of the store.
 * @param opts - Optional configuration.
 *
 * @returns `WritableStore<T>` — a store with the following API:
 *
 * @returnsTable get() | () => T | Returns the current value.
 * set(value) | (value: T) => void | Sets a new value and notifies subscribers.
 * update(fn) | (fn: (current: T) => T) => void | Updates the value using a function of the current value.
 * source | callbag | The underlying callbag source for subscriptions.
 *
 * @optionsType StoreOptions
 * @option name | string | undefined | Debug name for Inspector.
 * @option equals | (a: T, b: T) => boolean | Object.is | Equality function to prevent redundant emissions.
 *
 * @remarks **Equality guard:** `equals` defaults to `Object.is`. If `set()` is called with a value equal to the current value, the emission is skipped entirely.
 * @remarks **Post-completion no-op:** `set()` is a no-op after `complete()` or `error()`. Both the value update and the emission are skipped. This differs from TC39 Signals, where `Signal.State` has no completion concept.
 * @remarks **Batching:** Within `batch()`, DIRTY signals propagate immediately but DATA emission is deferred until the outermost batch ends. Multiple `set()` calls in a batch coalesce to only the latest value.
 * @remarks **Pre-bound `set`:** The `set` method is bound at construction, so it is safe to destructure: `const { set } = myState`.
 *
 * @example
 * ```ts
 * import { state } from 'callbag-recharge';
 *
 * const count = state(0);
 *
 * count.get(); // 0
 * count.set(1);
 * count.get(); // 1
 * ```
 *
 * @example Update with a function
 * ```ts
 * const count = state(0);
 * count.update(n => n + 1);
 * count.get(); // 1
 * ```
 *
 * @example Custom equals for objects
 * ```ts
 * const pos = state(
 *   { x: 0, y: 0 },
 *   { equals: (a, b) => a.x === b.x && a.y === b.y }
 * );
 *
 * pos.set({ x: 0, y: 0 }); // no emission — values are equal
 * ```
 *
 * @example Batching multiple sets
 * ```ts
 * import { state, derived, batch } from 'callbag-recharge';
 *
 * const a = state(1);
 * const b = state(2);
 * const sum = derived([a, b], () => a.get() + b.get());
 *
 * batch(() => {
 *   a.set(10);
 *   b.set(20);
 * });
 * // sum recomputes only once, after the batch completes
 * sum.get(); // 30
 * ```
 *
 * @seeAlso [derived](./derived) — computed stores from dependencies, [effect](./effect) — side-effects on store changes, [producer](./producer) — general-purpose push source, [batch](./batch) — atomic multi-store updates
 */
export function state<T>(initial: T, opts?: StoreOptions<T>): WritableStore<T> {
	return new StateImpl<T>(initial, opts) as any;
}
