import { Inspector } from "../inspector";
import { producer } from "../producer";
import { END, START } from "../protocol";
import type { Store, StoreOperator } from "../types";
import { subscribe } from "./subscribe";

/**
 * Accumulates upstream values into arrays. When the notifier emits,
 * the buffered array is flushed downstream and a new buffer starts.
 *
 * Stateful: maintains current buffer and last flushed array via producer.
 * get() returns the last flushed array (empty array before first flush).
 *
 * v3: Tier 2 — each flush starts a new DIRTY+value cycle (autoDirty: true).
 * Notifier is subscribed via raw callbag for END detection.
 */
export function buffer<A>(notifier: Store<unknown>): StoreOperator<A, A[]> {
	return (input: Store<A>) => {
		const store = producer<A[]>(
			({ emit }) => {
				let currentBuffer: A[] = [];

				const inputUnsub = subscribe(input, (v) => {
					currentBuffer.push(v);
				});

				let notifierTalkback: ((type: number) => void) | null = null;
				notifier.source(START, (type: number, data: unknown) => {
					if (type === START) notifierTalkback = data as (type: number) => void;
					if (type === 1 && currentBuffer.length > 0) {
						const flushed = currentBuffer;
						Object.freeze(flushed);
						currentBuffer = [];
						emit(flushed);
					}
					if (type === END) notifierTalkback = null;
				});

				return () => {
					if (notifierTalkback) notifierTalkback(END);
					currentBuffer = [];
					inputUnsub();
				};
			},
			{ initial: [] as A[] },
		);

		Inspector.register(store, { kind: "buffer" });
		return store;
	};
}
