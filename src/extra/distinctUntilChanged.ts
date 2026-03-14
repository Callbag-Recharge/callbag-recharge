import { Inspector } from "../inspector";
import { DATA, END, RESOLVED, START, STATE } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Filters out consecutive duplicate values. When upstream emits a value equal
 * to the cached one, sends RESOLVED downstream (enabling subtree skipping)
 * instead of re-emitting the unchanged value.
 *
 * Stateful: maintains cached value for equality comparison. get() returns
 * cached value when connected, delegates to input.get() when disconnected.
 *
 * v3: forwards DIRTY on type 3 STATE; on type 1 DATA checks equality and
 * emits or sends RESOLVED.
 */
export function distinctUntilChanged<A>(eq?: (a: A, b: A) => boolean): StoreOperator<A, A> {
	const eqFn = eq ?? Object.is;
	return (input: Store<A>) => {
		let cachedValue: A = input.get();
		let hasCached = false;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let connected = false;
		let talkback: ((type: number) => void) | null = null;

		function connectUpstream(): void {
			cachedValue = input.get();
			hasCached = true;
			input.source(START, (type: number, data: any) => {
				if (type === START) {
					talkback = data;
					return;
				}
				if (type === STATE) {
					for (const sink of sinks) sink(STATE, data);
				}
				if (type === DATA) {
					if (!hasCached || !eqFn(cachedValue, data as A)) {
						cachedValue = data as A;
						hasCached = true;
						for (const sink of sinks) sink(DATA, cachedValue);
					} else {
						// Duplicate — resolve downstream without emitting a new value
						for (const sink of sinks) sink(STATE, RESOLVED);
					}
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
		}

		const store: Store<A> = {
			get() {
				// Delegate to input when not connected so get() is always live
				return connected ? cachedValue : input.get();
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

		Inspector.register(store, { kind: "distinctUntilChanged" });
		return store;
	};
}
