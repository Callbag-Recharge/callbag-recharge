/**
 * A writable store, subclass of ProducerImpl.
 * Adds set()/update() API and defaults equals to Object.is.
 *
 * v5: _status packed into _flags bits 7-9 (inherited from ProducerImpl).
 * set() fast path uses pre-shifted status constants for zero-overhead writes.
 */

import { Inspector } from "./inspector";
import {
	P_AUTO_DIRTY,
	P_COMPLETED,
	P_PENDING,
	ProducerImpl,
	_STATUS_MASK,
	_S_DIRTY,
	_S_SETTLED,
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
			if (this._flags & P_AUTO_DIRTY) {
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

export function state<T>(initial: T, opts?: StoreOptions<T>): WritableStore<T> {
	return new StateImpl<T>(initial, opts) as any;
}
