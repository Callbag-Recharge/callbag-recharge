import { Inspector } from "../inspector";
import { DATA, END, pushDirty, START } from "../protocol";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Passes through the first `n` value changes from upstream, then holds
 * the last accepted value. Only counts actual changes (not the initial read).
 */
export function take<A>(n: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		let currentValue: A | undefined;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let count = 0;
		let started = false;
		let unsub: (() => void) | null = null;

		function start() {
			if (started) return;
			started = true;
			unsub = subscribe(input, (v) => {
				if (count < n && !Object.is(currentValue, v)) {
					count++;
					currentValue = v;
					pushDirty(sinks);
				}
			});
		}

		const store: Store<A | undefined> = {
			get() {
				return currentValue;
			},
			source(type: number, payload?: unknown) {
				if (type === START) {
					start();
					const sink = payload as (type: number, data?: unknown) => void;
					sinks.add(sink);
					sink(START, (t: number) => {
						if (t === DATA) sink(DATA, currentValue);
						if (t === END) {
							sinks.delete(sink);
							if (sinks.size === 0 && unsub) {
								unsub();
								unsub = null;
								started = false;
							}
						}
					});
				}
			},
		};

		Inspector.register(store, { kind: "take" });
		return store;
	};
}
