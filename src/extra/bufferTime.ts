import { Inspector } from "../inspector";
import { DATA, END, pushChange, START } from "../protocol";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Time-windowed buffering. Accumulates upstream values and flushes
 * the buffer every `ms` milliseconds. Combines timer + accumulation.
 * Timers and buffers are released on unsubscribe.
 */
export function bufferTime<A>(ms: number): StoreOperator<A, A[]> {
	return (input: Store<A>) => {
		let currentBuffer: A[] = [];
		let flushedValue: A[] = [];
		let timer: ReturnType<typeof setInterval> | null = null;
		const sinks = new Set<(type: number, data?: unknown) => void>();
		let started = false;
		let unsub: (() => void) | null = null;

		function start() {
			if (started) return;
			started = true;
			currentBuffer = [];
			flushedValue = [];

			unsub = subscribe(input, (v) => {
				currentBuffer.push(v);
			});

			timer = setInterval(() => {
				if (currentBuffer.length > 0) {
					flushedValue = currentBuffer;
					Object.freeze(flushedValue);
					currentBuffer = [];
					pushChange(sinks, () => flushedValue);
				}
			}, ms);
		}

		function stop() {
			if (!started) return;
			started = false;
			currentBuffer = [];
			flushedValue = [];
			if (timer !== null) {
				clearInterval(timer);
				timer = null;
			}
			if (unsub) {
				unsub();
				unsub = null;
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

		Inspector.register(store, { kind: "bufferTime" });
		return store;
	};
}
