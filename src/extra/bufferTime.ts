import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Time-windowed buffering. Accumulates upstream values and flushes
 * the buffer every `ms` milliseconds.
 *
 * Stateful: maintains current buffer and last flushed array via producer.
 * get() returns the last flushed array (empty array before first flush).
 *
 * v3: Tier 2 — each flush starts a new DIRTY+value cycle (autoDirty: true).
 * No equals — each flushed array is a new reference.
 */
export function bufferTime<A>(ms: number): StoreOperator<A, A[]> {
	return (input: Store<A>) => {
		const store = producer<A[]>(
			({ emit, error, complete }) => {
				let currentBuffer: A[] = [];

				const unsub = subscribe(
					input,
					(v) => {
						currentBuffer.push(v);
					},
					{
						onEnd: (err) => {
							clearInterval(timer);
							if (err !== undefined) {
								error(err);
							} else {
								// Flush remaining buffer on completion
								if (currentBuffer.length > 0) {
									const flushed = currentBuffer;
									Object.freeze(flushed);
									currentBuffer = [];
									emit(flushed);
								}
								complete();
							}
						},
					},
				);

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
