import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Flushes accumulated values every `ms` milliseconds as an array (Tier 2).
 *
 * @param ms - Timer interval for flushes.
 *
 * @returns `StoreOperator<A, A[]>` — last flushed buffer from `get()`.
 *
 * @seeAlso [buffer](/api/buffer)
 *
 * @category extra
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
