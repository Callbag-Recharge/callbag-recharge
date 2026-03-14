import { Inspector } from "../inspector";
import { DATA, DIRTY, END, START } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Like `share` but caches the last value. New subscribers immediately
 * receive the cached value. The cache is released on teardown
 * (when the last sink disconnects).
 *
 * In callbag-recharge stores are inherently multicast, so `remember`
 * primarily adds replay-last semantics for stream-backed sources whose
 * `get()` returns undefined before the first emission.
 *
 * Raw-callbag two-phase node: forwards DIRTY in phase 1, updates cache
 * and emits value in phase 2. Glitch-free in diamond topologies.
 */
export function remember<A>(): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		let cachedValue: A | undefined;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let connected = false;
		let talkback: ((type: number) => void) | null = null;
		let dirty = false;

		function connectUpstream(): void {
			cachedValue = input.get();
			input.source(START, (type: number, data: any) => {
				if (type === START) {
					talkback = data;
					return;
				}
				if (type === DATA) {
					if (data === DIRTY) {
						if (!dirty) {
							dirty = true;
							for (const sink of sinks) sink(DATA, DIRTY);
						}
					} else if (dirty) {
						dirty = false;
						cachedValue = data as A;
						for (const sink of sinks) sink(DATA, cachedValue);
					}
				}
				if (type === END) {
					talkback = null;
					connected = false;
					dirty = false;
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
			dirty = false;
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
