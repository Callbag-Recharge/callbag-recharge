import { Inspector } from "../inspector";
import {
	beginDeferredStart,
	DATA,
	DIRTY,
	END,
	endDeferredStart,
	pushChange,
	START,
} from "../protocol";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Maps each upstream value to an inner store via `fn`. While an inner is active,
 * new outer values are ignored. The next outer value is accepted only after the
 * current inner completes (sends END).
 */
export function exhaustMap<A, B>(fn: (value: A) => Store<B>): StoreOperator<A, B | undefined> {
	return (outer: Store<A>) => {
		let currentValue: B | undefined;
		let innerTalkback: ((type: number) => void) | null = null;
		let innerActive = false;
		let outerUnsub: (() => void) | null = null;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let started = false;

		function emitChange(value: B | undefined) {
			if (Object.is(currentValue, value)) return;
			currentValue = value;
			pushChange(sinks, () => currentValue);
		}

		function subscribeInner(innerStore: Store<B>) {
			innerActive = true;
			beginDeferredStart();
			emitChange(innerStore.get());
			innerStore.source(START, (type: number, data: unknown) => {
				if (type === START) innerTalkback = data as (type: number) => void;
				if (type === DATA) {
					if (data === DIRTY) {
						// Phase 1: inner is dirty
					} else {
						// Phase 2: value from inner
						emitChange(data as B);
					}
				}
				if (type === END) {
					innerTalkback = null;
					innerActive = false;
				}
			});
			endDeferredStart();
		}

		function start() {
			if (started) return;
			started = true;
			const initialValue = outer.get();
			outerUnsub = subscribe(outer, (v) => {
				if (!innerActive) subscribeInner(fn(v));
			});
			subscribeInner(fn(initialValue));
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
			innerActive = false;
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

		Inspector.register(store, { kind: "exhaustMap" });
		return store;
	};
}
