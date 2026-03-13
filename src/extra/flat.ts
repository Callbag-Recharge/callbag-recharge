import {
	DATA,
	DIRTY,
	END,
	START,
	beginDeferredStart,
	endDeferredStart,
} from "../protocol";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Flattens a store of stores with switch semantics: when the outer store
 * emits a new inner store, unsubscribes from the previous inner and
 * subscribes to the new one.
 */
export function flat<T>(): StoreOperator<Store<T> | undefined, T | undefined> {
	return (outer: Store<Store<T> | undefined>) => {
		// We use the raw callbag protocol for the output store so we can
		// manage inner subscriptions manually.
		let currentValue: T | undefined = undefined;
		let innerTalkback: ((type: number) => void) | null = null;
		let outerUnsub: (() => void) | null = null;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let started = false;

		function emit(value: T | undefined) {
			if (Object.is(currentValue, value)) return;
			currentValue = value;
			// Push DIRTY to our own sinks
			for (const sink of sinks) sink(DATA, DIRTY);
		}

		function subscribeInner(innerStore: Store<T>) {
			// Disconnect previous inner
			if (innerTalkback) {
				innerTalkback(END);
				innerTalkback = null;
			}

			beginDeferredStart();

			// Emit initial value of the new inner store
			emit(innerStore.get());

			innerStore.source(START, (type: number, data: unknown) => {
				if (type === START) {
					innerTalkback = data as (type: number) => void;
				}
				if (type === DATA && data === DIRTY) {
					emit(innerStore.get());
				}
				// Inner END is silently absorbed — we wait for the next inner
				// from the outer store
			});

			endDeferredStart();
		}

		function start() {
			if (started) return;
			started = true;

			outerUnsub = subscribe(outer, (innerStore) => {
				if (innerStore === undefined) {
					// Outer emitted undefined — disconnect inner
					if (innerTalkback) {
						innerTalkback(END);
						innerTalkback = null;
					}
					emit(undefined);
				} else {
					subscribeInner(innerStore);
				}
			});

			// Also subscribe to the initial inner value
			const initial = outer.get();
			if (initial !== undefined) {
				subscribeInner(initial);
			}
		}

		function stop() {
			if (!started) return;
			started = false;
			if (outerUnsub) {
				outerUnsub();
				outerUnsub = null;
			}
			if (innerTalkback) {
				innerTalkback(END);
				innerTalkback = null;
			}
		}

		const store: Store<T | undefined> = {
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

		return store;
	};
}
