import { Inspector } from "../inspector";
import { DATA, DIRTY, END, pushChange, START } from "../protocol";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Accumulates upstream values into arrays. When the notifier emits,
 * the buffered array is flushed downstream and a new buffer starts.
 * Buffers are released on unsubscribe.
 */
export function buffer<A>(notifier: Store<unknown>): StoreOperator<A, A[]> {
	return (input: Store<A>) => {
		let currentBuffer: A[] = [];
		let flushedValue: A[] = [];
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let started = false;
		let inputUnsub: (() => void) | null = null;
		let notifierTalkback: ((type: number) => void) | null = null;

		function start() {
			if (started) return;
			started = true;
			currentBuffer = [];
			flushedValue = [];

			inputUnsub = subscribe(input, (v) => {
				currentBuffer.push(v);
			});

			notifier.source(START, (type: number, data: unknown) => {
				if (type === START) notifierTalkback = data as (type: number) => void;
				if (type === DATA && data !== DIRTY && currentBuffer.length > 0) {
					flushedValue = currentBuffer;
					Object.freeze(flushedValue);
					currentBuffer = [];
					pushChange(sinks, () => flushedValue);
				}
				if (type === END) notifierTalkback = null;
			});
		}

		function stop() {
			if (!started) return;
			started = false;
			currentBuffer = [];
			flushedValue = [];
			if (inputUnsub) {
				inputUnsub();
				inputUnsub = null;
			}
			if (notifierTalkback) {
				notifierTalkback(END);
				notifierTalkback = null;
			}
		}

		const store: Store<A[]> = {
			get() {
				return flushedValue;
			},
			source(type: number, payload?: unknown) {
				if (type === START) {
					start();
					const sink = payload as (type: number, data?: unknown) => void;
					sinks.add(sink);
					sink(START, (t: number) => {
						if (t === DATA) sink(DATA, flushedValue);
						if (t === END) {
							sinks.delete(sink);
							if (sinks.size === 0) stop();
						}
					});
				}
			},
		};

		Inspector.register(store, { kind: "buffer" });
		return store;
	};
}
