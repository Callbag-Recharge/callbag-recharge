import { Inspector } from "../inspector";
import { DATA, END, pushDirty, START } from "../protocol";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Delays each upstream value by `ms` milliseconds.
 * Unlike debounce, each value gets its own independent timer.
 * Pending timers are cleared on unsubscribe.
 */
export function delay<A>(ms: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		let currentValue: A | undefined;
		const timers = new Set<ReturnType<typeof setTimeout>>();
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let started = false;
		let unsub: (() => void) | null = null;

		function start() {
			if (started) return;
			started = true;
			unsub = subscribe(input, (v) => {
				const id = setTimeout(() => {
					timers.delete(id);
					if (!Object.is(currentValue, v)) {
						currentValue = v;
						pushDirty(sinks);
					}
				}, ms);
				timers.add(id);
			});
		}

		function stop() {
			if (!started) return;
			started = false;
			currentValue = undefined;
			for (const id of timers) clearTimeout(id);
			timers.clear();
			if (unsub) {
				unsub();
				unsub = null;
			}
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
							if (sinks.size === 0) stop();
						}
					});
				}
			},
		};

		Inspector.register(store, { kind: "delay" });
		return store;
	};
}
