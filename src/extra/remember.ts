import { Inspector } from "../inspector";
import { DATA, END, pushDirty, START } from "../protocol";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Like `share` but caches the last value. New subscribers immediately
 * receive the cached value. The cache is released on teardown
 * (when the last sink disconnects).
 *
 * In callbag-recharge stores are inherently multicast, so `remember`
 * primarily adds replay-last semantics for stream-backed sources whose
 * `get()` returns undefined before the first emission.
 */
export function remember<A>(): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		let cachedValue: A | undefined;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let started = false;
		let unsub: (() => void) | null = null;

		function start() {
			if (started) return;
			started = true;
			cachedValue = input.get();
			unsub = subscribe(input, (v) => {
				cachedValue = v;
				pushDirty(sinks);
			});
		}

		function stop() {
			if (!started) return;
			started = false;
			cachedValue = undefined;
			if (unsub) {
				unsub();
				unsub = null;
			}
		}

		const store: Store<A | undefined> = {
			get() {
				return cachedValue;
			},
			source(type: number, payload?: unknown) {
				if (type === START) {
					start();
					const sink = payload as (type: number, data?: unknown) => void;
					sinks.add(sink);
					sink(START, (t: number) => {
						if (t === DATA) sink(DATA, cachedValue);
						if (t === END) {
							sinks.delete(sink);
							if (sinks.size === 0) stop();
						}
					});
				}
			},
		};

		Inspector.register(store, { kind: "remember" });
		return store;
	};
}
