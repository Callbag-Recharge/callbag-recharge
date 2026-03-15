/**
 * A writable store, subclass of ProducerImpl.
 * Adds set()/update() API and defaults equals to Object.is.
 *
 * Stateful: maintains value via producer. get() returns current value.
 * set() = emit(), update(fn) = emit(fn(get())).
 *
 * v3: inherits producer's autoDirty — set() sends DIRTY on type 3 then
 * value on type 1. Object.is equality guard prevents redundant emissions.
 *
 * Note on completion: set() delegates to emit(), which is a no-op after
 * complete()/error() — both the emission and the _value update are skipped.
 * This differs from TC39 Signals where Signal.State has no completion
 * concept and is always writable for its entire lifetime. The divergence
 * is intentional: callbag-recharge is stream-based (callbag protocol with
 * START/DATA/END), so completion semantics apply. TC39 Signals are
 * persistent reactive cells with no lifecycle.
 */

import { Inspector } from "./inspector";
import { ProducerImpl } from "./producer";
import type { StoreOptions, WritableStore } from "./types";

export class StateImpl<T> extends ProducerImpl<T> {
	constructor(initial: T, opts?: StoreOptions<T>) {
		super(undefined, {
			initial,
			autoDirty: true,
			equals: opts?.equals ?? Object.is,
			_skipInspect: true,
		});
		// Bind set so it works when detached (const { set } = myState)
		this.set = this.set.bind(this);
		Inspector.register(this as any, { kind: "state", ...opts });
	}

	override get(): T {
		return this._value as T;
	}

	set(value: T): void {
		this.emit(value);
	}

	update(fn: (current: T) => T): void {
		this.emit(fn(this._value as T));
	}
}

export function state<T>(initial: T, opts?: StoreOptions<T>): WritableStore<T> {
	return new StateImpl<T>(initial, opts) as any;
}
