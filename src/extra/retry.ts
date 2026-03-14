import { Inspector } from "../inspector";
import { beginDeferredStart, DATA, DIRTY, END, endDeferredStart, START } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Re-subscribes to the input source up to `n` times on error (END with error).
 * Tests verify old subscriptions are cleaned up before retry.
 */
export function retry<A>(n: number): StoreOperator<A, A> {
	return (input: Store<A>) => {
		let currentValue: A | undefined;
		let retriesLeft = n;
		let inputTalkback: ((type: number) => void) | null = null;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let started = false;

		function emit(value: A) {
			if (Object.is(currentValue, value)) return;
			currentValue = value;
			for (const sink of sinks) sink(DATA, DIRTY);
		}

		function connectInput() {
			if (inputTalkback) {
				inputTalkback(END);
				inputTalkback = null;
			}
			beginDeferredStart();
			const initial = input.get();
			if (initial !== undefined) emit(initial as A);
			input.source(START, (type: number, data: unknown) => {
				if (type === START) inputTalkback = data as (type: number) => void;
				if (type === DATA && data === DIRTY) emit(input.get());
				if (type === END) {
					inputTalkback = null;
					if (data !== undefined && retriesLeft > 0) {
						retriesLeft--;
						connectInput();
					} else {
						// Error with retries exhausted, or normal completion — forward downstream
						const snapshot = [...sinks];
						sinks.clear();
						for (const sink of snapshot) sink(END, data);
					}
				}
			});
			endDeferredStart();
		}

		function start() {
			if (started) return;
			started = true;
			retriesLeft = n;
			connectInput();
		}

		function stop() {
			if (!started) return;
			started = false;
			if (inputTalkback) {
				inputTalkback(END);
				inputTalkback = null;
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

		Inspector.register(store, { kind: "retry" });
		return store;
	};
}
