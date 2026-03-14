import { Inspector } from "../inspector";
import { DATA, END, pushDirty, START } from "../protocol";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Side-effect passthrough operator. Calls `fn` for each upstream value
 * without altering it. Useful for debugging and logging.
 */
export function tap<A>(fn: (value: A) => void): StoreOperator<A, A> {
	return (input: Store<A>) => {
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let started = false;
		let unsub: (() => void) | null = null;

		function start() {
			if (started) return;
			started = true;
			unsub = subscribe(input, (v) => {
				fn(v);
				pushDirty(sinks);
			});
		}

		function stop() {
			if (!started) return;
			started = false;
			if (unsub) {
				unsub();
				unsub = null;
			}
		}

		const store: Store<A> = {
			get() {
				return input.get();
			},
			source(type: number, payload?: unknown) {
				if (type === START) {
					start();
					const sink = payload as (type: number, data?: unknown) => void;
					sinks.add(sink);
					sink(START, (t: number) => {
						if (t === DATA) sink(DATA, input.get());
						if (t === END) {
							sinks.delete(sink);
							if (sinks.size === 0) stop();
						}
					});
				}
			},
		};

		Inspector.register(store, { kind: "tap" });
		return store;
	};
}
