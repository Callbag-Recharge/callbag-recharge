/**
 * A writable store, thin wrapper over producer().
 * Adds set()/update() API and defaults equals to Object.is.
 *
 * Stateful: maintains value via producer. get() returns current value.
 * set() = emit(), update(fn) = emit(fn(get())).
 *
 * v3: inherits producer's autoDirty — set() sends DIRTY on type 3 then
 * value on type 1. Object.is equality guard prevents redundant emissions.
 */

import { Inspector } from "./inspector";
import { producer } from "./producer";
import type { StoreOptions, WritableStore } from "./types";

export function state<T>(initial: T, opts?: StoreOptions<T>): WritableStore<T> {
	const p = producer<T>(undefined, {
		initial,
		autoDirty: true,
		equals: opts?.equals ?? Object.is,
		_skipInspect: true,
	});

	const store: WritableStore<T> = {
		get: () => p.get() as T,
		set: p.emit,
		update(fn: (current: T) => T) {
			p.emit(fn(p.get() as T));
		},
		source: p.source,
	};

	Inspector.register(store, { kind: "state", ...opts });
	return store;
}
