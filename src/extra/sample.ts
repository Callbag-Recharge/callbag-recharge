import { Inspector } from "../inspector";
import { DATA, DIRTY, END, pushChange, START } from "../protocol";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Emits the latest value from the input source whenever the notifier emits.
 * Dual-subscription lifecycle — both source and notifier are torn down on unsubscribe.
 */
export function sample<A>(notifier: Store<unknown>): StoreOperator<A, A> {
	return (input: Store<A>) => {
		let currentValue: A | undefined;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let started = false;
		let inputUnsub: (() => void) | null = null;
		let notifierTalkback: ((type: number) => void) | null = null;

		function start() {
			if (started) return;
			started = true;
			currentValue = input.get();

			// Subscribe to input to keep currentValue up to date (no push downstream)
			inputUnsub = subscribe(input, (v) => {
				currentValue = v;
			});

			// Subscribe to notifier — push downstream when notifier fires
			notifier.source(START, (type: number, data: unknown) => {
				if (type === START) notifierTalkback = data as (type: number) => void;
				if (type === DATA && data !== DIRTY) {
					pushChange(sinks, () => currentValue);
				}
				if (type === END) notifierTalkback = null;
			});
		}

		function stop() {
			if (!started) return;
			started = false;
			if (inputUnsub) {
				inputUnsub();
				inputUnsub = null;
			}
			if (notifierTalkback) {
				notifierTalkback(END);
				notifierTalkback = null;
			}
		}

		const store: Store<A> = {
			get() {
				return currentValue as A;
			},
			source(type: number, payload?: unknown) {
				if (type === START) {
					start();
					const sink = payload as (type: number, data?: unknown) => void;
					sinks.add(sink);
					sink(START, (t: number) => {
						if (t === DATA) sink(DATA, currentValue);
						if (t === END) {
							sinks.delete(sink);
							if (sinks.size === 0) stop();
						}
					});
				}
			},
		};

		Inspector.register(store, { kind: "sample" });
		return store;
	};
}
