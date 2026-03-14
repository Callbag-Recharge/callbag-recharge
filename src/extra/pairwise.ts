import { Inspector } from "../inspector";
import { DATA, END, pushDirty, START } from "../protocol";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Emits [prev, curr] pairs on each upstream change.
 * get() returns undefined until the second value arrives (i.e. until first upstream change).
 * The "prev" in the first pair is the value upstream held at subscription time.
 */
export function pairwise<A>(): StoreOperator<A, [A, A] | undefined> {
	return (input: Store<A>) => {
		let currentPair: [A, A] | undefined;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let started = false;
		let unsub: (() => void) | null = null;

		function start() {
			if (started) return;
			started = true;
			// subscribe tracks prev internally; we use it directly from the callback.
			unsub = subscribe(input, (v, prev) => {
				currentPair = [prev as A, v];
				pushDirty(sinks);
			});
		}

		function stop() {
			if (!started) return;
			started = false;
			currentPair = undefined;
			if (unsub) {
				unsub();
				unsub = null;
			}
		}

		const store: Store<[A, A] | undefined> = {
			get() {
				return currentPair;
			},
			source(type: number, payload?: unknown) {
				if (type === START) {
					start();
					const sink = payload as (type: number, data?: unknown) => void;
					sinks.add(sink);
					sink(START, (t: number) => {
						if (t === DATA) sink(DATA, currentPair);
						if (t === END) {
							sinks.delete(sink);
							if (sinks.size === 0) stop();
						}
					});
				}
			},
		};

		Inspector.register(store, { kind: "pairwise" });
		return store;
	};
}
