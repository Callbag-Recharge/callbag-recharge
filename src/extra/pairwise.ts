import { Inspector } from "../inspector";
import { DATA, DIRTY, END, START } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Emits [prev, curr] pairs on each upstream change.
 * get() returns undefined until the first upstream change arrives.
 * The "prev" in the first pair is the value upstream held at subscription time.
 *
 * Raw-callbag two-phase node: forwards DIRTY in phase 1, creates pair
 * and emits in phase 2. Glitch-free in diamond topologies.
 */
export function pairwise<A>(): StoreOperator<A, [A, A] | undefined> {
	return (input: Store<A>) => {
		let currentPair: [A, A] | undefined;
		let prev: A | undefined;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let connected = false;
		let talkback: ((type: number) => void) | null = null;
		let dirty = false;

		function connectUpstream(): void {
			prev = input.get();
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
						currentPair = [prev as A, data as A];
						prev = data as A;
						for (const sink of sinks) sink(DATA, currentPair);
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
			currentPair = undefined;
		}

		const store: Store<[A, A] | undefined> = {
			get() {
				return currentPair;
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
						if (t === DATA) sink(DATA, currentPair);
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

		Inspector.register(store, { kind: "pairwise" });
		return store;
	};
}
