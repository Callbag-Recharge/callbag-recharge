// ---------------------------------------------------------------------------
// state(initial) — a writable store
// ---------------------------------------------------------------------------
// Standalone implementation (not built on top of producer()) for a simpler
// code path: no fn, no lazy-start machinery, no autoDirty option needed.
// The architecture document describes state as "sugar over producer" to
// communicate the conceptual relationship, not the implementation strategy.
// Both implementations are equivalent; this one is leaner for the common case.
//
// Type 3 DIRTY propagates immediately. Type 1 value defers during batch.
// Coalesces multiple set() calls during batch into a single emission.
// ---------------------------------------------------------------------------

import { Inspector } from "./inspector";
import { DATA, DIRTY, deferEmission, END, isBatching, START, STATE } from "./protocol";
import type { StoreOptions, WritableStore } from "./types";

export function state<T>(initial: T, opts?: StoreOptions<T>): WritableStore<T> {
	let currentValue = initial;
	const sinks = new Set<any>();
	const eq = opts?.equals ?? Object.is;
	let pendingEmission = false;

	function emitValue(): void {
		pendingEmission = false;
		const v = currentValue;
		for (const sink of sinks) sink(DATA, v);
	}

	const store: WritableStore<T> = {
		get() {
			return currentValue;
		},

		set(value: T) {
			if (eq(currentValue, value)) return;
			currentValue = value;
			if (sinks.size === 0) return;
			if (isBatching()) {
				if (!pendingEmission) {
					pendingEmission = true;
					for (const sink of sinks) sink(STATE, DIRTY);
					deferEmission(emitValue);
				}
			} else {
				for (const sink of sinks) sink(STATE, DIRTY);
				emitValue();
			}
		},

		update(fn: (current: T) => T) {
			store.set(fn(currentValue));
		},

		source(type: number, payload?: any) {
			if (type === START) {
				const sink = payload;
				sinks.add(sink);
				sink(START, (t: number) => {
					if (t === DATA) sink(DATA, currentValue);
					if (t === END) sinks.delete(sink);
				});
			}
		},
	};

	Inspector.register(store, { kind: "state", ...opts });
	return store;
}
