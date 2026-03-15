import { Inspector } from "../inspector";
import { producer } from "../producer";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Time-windowed buffering. Accumulates upstream values and flushes
 * the buffer every `ms` milliseconds.
 * Tier 2 — each emit starts a new DIRTY+value cycle (autoDirty: true).
 */
export function bufferTime<A>(ms: number): StoreOperator<A, A[]> {
	return (input: Store<A>) => {
		const store = producer<A[]>(
			({ emit }) => {
				let currentBuffer: A[] = [];

				const unsub = subscribe(input, (v) => {
					currentBuffer.push(v);
				});

				const timer = setInterval(() => {
					if (currentBuffer.length > 0) {
						const flushed = currentBuffer;
						Object.freeze(flushed);
						currentBuffer = [];
						emit(flushed);
					}
				}, ms);

				return () => {
					clearInterval(timer);
					currentBuffer = [];
					unsub();
				};
			},
			{ initial: [] as A[] },
		);

		Inspector.register(store, { kind: "bufferTime" });
		return store;
	};
}
