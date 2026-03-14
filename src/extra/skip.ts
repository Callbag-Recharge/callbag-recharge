import { Inspector } from "../inspector";
import { DATA, DIRTY, END, START } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Skips the first `n` value changes from upstream, then passes through
 * all subsequent ones. Only counts actual changes (not the initial read).
 *
 * Raw-callbag two-phase node: suppresses DIRTY during skip phase,
 * forwards DIRTY and emits values after skip threshold.
 * Glitch-free in diamond topologies.
 */
export function skip<A>(n: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		let currentValue: A | undefined;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let emissionCount = 0;
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
						if (!dirty) {
							dirty = true;
							if (emissionCount >= n) {
								for (const sink of sinks) sink(DATA, DIRTY);
							}
						}
					} else if (dirty) {
						dirty = false;
						emissionCount++;
						if (emissionCount > n) {
							currentValue = data;
							for (const sink of sinks) sink(DATA, currentValue);
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
					if (wasEmpty) {
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

		Inspector.register(store, { kind: "skip" });
		return store;
	};
}
