import { Inspector } from "../inspector";
import { DATA, END, START, STATE } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Passes through the first `n` value changes from upstream, then disconnects
 * and completes. Subsequent subscribers receive END immediately.
 *
 * Stateful: maintains own cached value. get() returns the last accepted
 * value (or undefined before first emission). Frozen after completion.
 *
 * v3: type 3 STATE carries DIRTY/RESOLVED signals; type 1 DATA is pure values.
 * Forwards STATE signals while count < n. Counts only actual DATA emissions.
 */
export function take<A>(n: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		let currentValue: A | undefined;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let count = 0;
		let connected = false;
		let completed = false;
		let talkback: ((type: number) => void) | null = null;

		function connectUpstream(): void {
			input.source(START, (type: number, data: any) => {
				if (type === START) {
					talkback = data;
					return;
				}
				if (type === STATE) {
					if (count < n) {
						for (const sink of sinks) sink(STATE, data);
					}
				}
				if (type === DATA) {
					if (count < n) {
						count++;
						currentValue = data;
						for (const sink of sinks) sink(DATA, currentValue);
						if (count >= n) {
							disconnectUpstream();
							completed = true;
							const snapshot = [...sinks];
							sinks.clear();
							for (const sink of snapshot) sink(END);
						}
					}
				}
				if (type === END) {
					talkback = null;
					connected = false;
					const snapshot = [...sinks];
					sinks.clear();
					for (const sink of snapshot) sink(END, data);
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

		const store: Store<A | undefined> = {
			get() {
				return currentValue;
			},
			source(type: number, payload?: unknown) {
				if (type === START) {
					const sink = payload as (type: number, data?: unknown) => void;
					if (completed) {
						sink(START, () => {});
						sink(END);
						return;
					}
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
