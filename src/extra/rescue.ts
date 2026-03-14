import { Inspector } from "../inspector";
import { beginDeferredStart, DATA, DIRTY, END, endDeferredStart, START } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Error recovery operator. When the input source errors, calls `fn` with
 * the error and subscribes to the returned fallback source.
 * Similar resubscription lifecycle to retry.
 */
export function rescue<A>(fn: (error: unknown) => Store<A>): StoreOperator<A, A> {
	return (input: Store<A>) => {
		let currentValue: A | undefined;
		let activeTalkback: ((type: number) => void) | null = null;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let started = false;

		function emit(value: A) {
			if (Object.is(currentValue, value)) return;
			currentValue = value;
			for (const sink of sinks) sink(DATA, DIRTY);
		}

		function connectSource(source: Store<A>) {
			if (activeTalkback) {
				activeTalkback(END);
				activeTalkback = null;
			}
			beginDeferredStart();
			const initial = source.get();
			if (initial !== undefined) emit(initial as A);
			source.source(START, (type: number, data: unknown) => {
				if (type === START) activeTalkback = data as (type: number) => void;
				if (type === DATA && data === DIRTY) emit(source.get());
				if (type === END) {
					activeTalkback = null;
					if (data !== undefined) {
						// Error — switch to fallback
						const fallback = fn(data);
						connectSource(fallback);
					} else {
						// Normal completion
						const snapshot = [...sinks];
						sinks.clear();
						for (const sink of snapshot) sink(END);
					}
				}
			});
			endDeferredStart();
		}

		function start() {
			if (started) return;
			started = true;
			connectSource(input);
		}

		function stop() {
			if (!started) return;
			started = false;
			if (activeTalkback) {
				activeTalkback(END);
				activeTalkback = null;
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

		Inspector.register(store, { kind: "rescue" });
		return store;
	};
}
