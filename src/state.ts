// ---------------------------------------------------------------------------
// state(initial) — a writable store, thin wrapper over producer()
// ---------------------------------------------------------------------------
// Conceptually and implementationally built on producer().
// Adds set()/update() API and defaults equals to Object.is.
// The cast from T|undefined to T is safe because initial is always provided.
// ---------------------------------------------------------------------------

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
