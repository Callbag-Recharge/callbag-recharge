import { Inspector } from "../inspector";
import { DATA, END, pushDirty, START } from "../protocol";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Passes the first upstream change through immediately, then silences further
 * changes for `ms` milliseconds. Leading-edge semantics.
 * Pending throttle timers are cleared on unsubscribe.
 */
export function throttle<A>(ms: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		let currentValue: A | undefined;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let started = false;
		let unsub: (() => void) | null = null;

		function start() {
			if (started) return;
			started = true;
			unsub = subscribe(input, (v) => {
				if (timer !== null) return; // still within throttle window
				if (!Object.is(currentValue, v)) {
					currentValue = v;
					pushDirty(sinks);
				}
				timer = setTimeout(() => {
					timer = null;
				}, ms);
			});
		}

		function stop() {
			if (!started) return;
			started = false;
			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}
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

		Inspector.register(store, { kind: "throttle" });
		return store;
	};
}
