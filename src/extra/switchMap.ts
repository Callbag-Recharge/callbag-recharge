import { Inspector } from "../inspector";
import { beginDeferredStart, DATA, DIRTY, END, endDeferredStart, START } from "../protocol";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Maps each upstream value to an inner store via `fn`, subscribing to the new inner
 * and unsubscribing from the previous one. The output reflects the latest inner store's value.
 */
export function switchMap<A, B>(fn: (value: A) => Store<B>): StoreOperator<A, B | undefined> {
	return (outer: Store<A>) => {
		let currentValue: B | undefined;
		let innerTalkback: ((type: number) => void) | null = null;
		let outerUnsub: (() => void) | null = null;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let started = false;

		function emit(value: B | undefined) {
			if (Object.is(currentValue, value)) return;
			currentValue = value;
			for (const sink of sinks) sink(DATA, DIRTY);
		}

		function subscribeInner(innerStore: Store<B>) {
			if (innerTalkback) {
				innerTalkback(END);
				innerTalkback = null;
			}
			beginDeferredStart();
			emit(innerStore.get());
			innerStore.source(START, (type: number, data: unknown) => {
				if (type === START) innerTalkback = data as (type: number) => void;
				if (type === DATA && data === DIRTY) emit(innerStore.get());
			});
			endDeferredStart();
		}

		function start() {
			if (started) return;
			started = true;
			outerUnsub = subscribe(outer, (v) => subscribeInner(fn(v)));
			subscribeInner(fn(outer.get()));
		}

		function stop() {
			if (!started) return;
			started = false;
			if (innerTalkback) {
				innerTalkback(END);
				innerTalkback = null;
			}
			if (outerUnsub) {
				outerUnsub();
				outerUnsub = null;
			}
		}

		const store: Store<B | undefined> = {
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

		Inspector.register(store, { kind: "switchMap" });
		return store;
	};
}
