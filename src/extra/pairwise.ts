import { Inspector } from "../inspector";
import { DATA, END, START, STATE } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Emits [prev, curr] pairs on each upstream change.
 * get() returns undefined until the first upstream change arrives.
 * The "prev" in the first pair is the value upstream held at subscription time.
 *
 * Stateful: maintains own cached [prev, curr] pair. get() returns the
 * last emitted pair, or undefined before the first upstream change.
 *
 * v3: forwards all type 3 STATE signals; creates pair and emits on type 1 DATA.
 */
export function pairwise<A>(): StoreOperator<A, [A, A] | undefined> {
	return (input: Store<A>) => {
		let currentPair: [A, A] | undefined;
		let prev: A | undefined;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let connected = false;
		let talkback: ((type: number) => void) | null = null;

		function connectUpstream(): void {
			prev = input.get();
			input.source(START, (type: number, data: any) => {
				if (type === START) {
					talkback = data;
					return;
				}
				if (type === STATE) {
					for (const sink of sinks) sink(STATE, data);
				}
				if (type === DATA) {
					currentPair = [prev as A, data as A];
					prev = data as A;
					for (const sink of sinks) sink(DATA, currentPair);
				}
				if (type === END) {
					talkback = null;
					connected = false;
					currentPair = undefined;
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
