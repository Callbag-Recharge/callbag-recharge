import { Inspector } from "../inspector";
import { DATA, END, START, STATE } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Caches the last upstream value and replays it to new subscribers.
 * Cache is cleared when the last sink disconnects (teardown).
 *
 * Stateful: maintains cached value. get() returns the last received value
 * (or undefined after teardown). New subscribers receive the cached value
 * immediately via talkback.
 *
 * v3: forwards all type 3 STATE signals; updates cache and emits on type 1 DATA.
 */
export function remember<A>(): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		let cachedValue: A | undefined;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let connected = false;
		let talkback: ((type: number) => void) | null = null;

		function connectUpstream(): void {
			cachedValue = input.get();
			input.source(START, (type: number, data: any) => {
				if (type === START) {
					talkback = data;
					return;
				}
				if (type === STATE) {
					for (const sink of sinks) sink(STATE, data);
				}
				if (type === DATA) {
					cachedValue = data as A;
					for (const sink of sinks) sink(DATA, cachedValue);
				}
				if (type === END) {
					talkback = null;
					connected = false;
					for (const sink of sinks) sink(END, data);
				}
			});
		}

		function disconnectUpstream(): void {
			if (talkback) {
				talkback(END);
				talkback = null;
			}
			connected = false;
			cachedValue = undefined;
		}

		const store: Store<A | undefined> = {
			get() {
				return cachedValue;
			},
			source(type: number, payload?: unknown) {
				if (type === START) {
					const sink = payload as (type: number, data?: unknown) => void;
					const wasEmpty = sinks.size === 0;
					sinks.add(sink);
					if (wasEmpty) {
						connectUpstream();
						connected = true;
					}
					sink(START, (t: number) => {
						if (t === DATA) sink(DATA, cachedValue);
						if (t === END) {
							sinks.delete(sink);
							if (sinks.size === 0 && connected) {
								disconnectUpstream();
							}
						}
					});
				}
			},
		};

		Inspector.register(store, { kind: "remember" });
		return store;
	};
}
