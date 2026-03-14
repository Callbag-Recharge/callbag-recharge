import { Inspector } from "../inspector";
import { DATA, END, pushChange, START } from "../protocol";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Errors if the input source does not emit within `ms` milliseconds.
 * The timer resets on each emission. If the timer fires, sinks receive
 * END with a TimeoutError. Timers are cleared on unsubscribe.
 */
export class TimeoutError extends Error {
	constructor(ms: number) {
		super(`Timeout: source did not emit within ${ms}ms`);
		this.name = "TimeoutError";
	}
}

export function timeout<A>(ms: number): StoreOperator<A, A> {
	return (input: Store<A>) => {
		let currentValue: A | undefined;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let started = false;
		let unsub: (() => void) | null = null;

		function resetTimer() {
			if (timer !== null) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = null;
				// Tear down upstream first, then notify sinks
				stop();
				const snapshot = [...sinks];
				sinks.clear();
				for (const sink of snapshot) sink(END, new TimeoutError(ms));
			}, ms);
		}

		function start() {
			if (started) return;
			started = true;
			currentValue = input.get();
			resetTimer();
			unsub = subscribe(input, (v) => {
				currentValue = v;
				resetTimer();
				pushChange(sinks, () => currentValue);
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

		const store: Store<A> = {
			get() {
				return currentValue as A;
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

		Inspector.register(store, { kind: "timeout" });
		return store;
	};
}
