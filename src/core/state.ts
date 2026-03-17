/**
 * A writable store, subclass of ProducerImpl.
 * Adds set()/update() API and defaults equals to Object.is.
 *
 * Stateful: maintains value via producer. get() returns current value.
 * set() inlines the emit logic for faster no-subscriber writes.
 * update(fn) = set(fn(get())).
 *
 * v3: inherits producer's autoDirty — set() sends DIRTY on type 3 then
 * value on type 1. Object.is equality guard prevents redundant emissions.
 *
 * v4.1: set() fast path — inlines emit() logic to skip the bound method
 * call overhead. For the no-subscriber case (_output === null), this is
 * just an Object.is check + _value assignment.
 *
 * Note on completion: set() is a no-op after complete()/error() — both the
 * emission and the _value update are skipped. This differs from TC39 Signals
 * where Signal.State has no completion concept and is always writable for
 * its entire lifetime. The divergence is intentional: callbag-recharge is
 * stream-based (callbag protocol with START/DATA/END), so completion
 * semantics apply. TC39 Signals are persistent reactive cells with no
 * lifecycle.
 */

import { Inspector } from "./inspector";
import { P_AUTO_DIRTY, P_COMPLETED, P_PENDING, ProducerImpl } from "./producer";
import { DATA, DIRTY, STATE, deferEmission, isBatching } from "./protocol";
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

	/**
	 * Fast path: inlines ProducerImpl.emit() to skip the bound method call.
	 * For no-subscriber writes, this is just an equals check + value assign.
	 */
	set(value: T): void {
		if (this._flags & P_COMPLETED) return;
		// _eqFn is always set for state (Object.is or custom)
		if (this._value !== undefined && this._eqFn!(this._value as T, value)) return;
		this._value = value;
		if (!this._output) return;
		// Subscriber dispatch — same logic as ProducerImpl.emit()
		if (isBatching()) {
			if (!(this._flags & P_PENDING)) {
				this._flags |= P_PENDING;
				if (this._flags & P_AUTO_DIRTY) {
					this._status = "DIRTY";
					this._dispatch(STATE, DIRTY);
				}
				deferEmission(() => {
					this._flags &= ~P_PENDING;
					this._status = "SETTLED";
					this._dispatch(DATA, this._value);
				});
			}
		} else {
			if (this._flags & P_AUTO_DIRTY) {
				this._status = "DIRTY";
				this._dispatch(STATE, DIRTY);
			}
			this._status = "SETTLED";
			this._dispatch(DATA, this._value);
		}
	}

	update(fn: (current: T) => T): void {
		this.set(fn(this._value as T));
	}
}

export function state<T>(initial: T, opts?: StoreOptions<T>): WritableStore<T> {
	return new StateImpl<T>(initial, opts) as any;
}
