import { Inspector } from "../inspector";
import { DATA, DIRTY, END, START } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Passes through the first `n` value changes from upstream, then holds
 * the last accepted value. Only counts actual changes (not the initial read).
 *
 * Raw-callbag two-phase node: forwards DIRTY in phase 1, emits transformed
 * values in phase 2. Glitch-free in diamond topologies.
 */
export function take<A>(n: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		let currentValue: A | undefined;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let count = 0;
		let connected = false;
		let talkback: ((type: number) => void) | null = null;
		let dirty = false;

		function connectUpstream(): void {
			input.source(START, (type: number, data: any) => {
				if (type === START) {
					talkback = data;
					return;
				}
				if (type === DATA) {
					if (data === DIRTY) {
						if (!dirty && count < n) {
							dirty = true;
							for (const sink of sinks) sink(DATA, DIRTY);
						}
					} else if (dirty) {
						dirty = false;
						if (!Object.is(currentValue, data)) {
							count++;
							currentValue = data;
						}
						for (const sink of sinks) sink(DATA, currentValue);
						if (count >= n) {
							disconnectUpstream();
						}
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
		}

		const store: Store<A | undefined> = {
			get() {
				return currentValue;
			},
			source(type: number, payload?: unknown) {
				if (type === START) {
					const sink = payload as (type: number, data?: unknown) => void;
					const wasEmpty = sinks.size === 0;
					sinks.add(sink);
					if (wasEmpty && count < n) {
						connectUpstream();
						connected = true;
					}
					sink(START, (t: number) => {
						if (t === DATA) sink(DATA, currentValue);
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

		Inspector.register(store, { kind: "take" });
		return store;
	};
}
