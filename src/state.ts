// ---------------------------------------------------------------------------
// state(initial) — a writable store
// ---------------------------------------------------------------------------

import { Inspector } from "./inspector";
import { DATA, END, pushChange, START } from "./protocol";
import type { StoreOptions, WritableStore } from "./types";

export function state<T>(initial: T, opts?: StoreOptions<T>): WritableStore<T> {
	let currentValue = initial;
	const sinks = new Set<any>();
	const eq = opts?.equals ?? Object.is;

	const store: WritableStore<T> = {
		get() {
			return currentValue;
		},

		set(value: T) {
			if (eq(currentValue, value)) return;
			currentValue = value;
			pushChange(sinks, () => currentValue);
		},

		update(fn: (current: T) => T) {
			store.set(fn(currentValue));
		},

		source(type: number, payload?: any) {
			if (type === START) {
				const sink = payload;
				sinks.add(sink);
				// Send talkback — supports pull (type 1) and disconnect (type 2)
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
