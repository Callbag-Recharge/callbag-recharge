import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Buffers N upstream values, then flushes the buffer as an array.
 *
 * When `startEvery` is provided, a new buffer opens every `startEvery` values
 * (sliding window). Without it, buffers are non-overlapping (tumbling window).
 *
 * Tier 2: each flush starts a new DIRTY+value cycle (autoDirty: true).
 *
 * On upstream completion, any partial buffer is flushed before completing.
 * On upstream error, partial buffer is discarded and error is forwarded.
 */
export function bufferCount<A>(count: number, startEvery?: number): StoreOperator<A, A[]> {
	return (input: Store<A>) => {
		const store = producer<A[]>(
			({ emit, error, complete }) => {
				if (startEvery !== undefined && startEvery > 0) {
					// Sliding window: multiple overlapping buffers
					let buffers: A[][] = [];
					let emitCount = 0;

					const unsub = subscribe(
						input,
						(v) => {
							if (emitCount % startEvery === 0) {
								buffers.push([]);
							}
							emitCount++;

							for (const buf of buffers) {
								buf.push(v);
							}

							// Flush any buffers that have reached count
							const toFlush: A[][] = [];
							buffers = buffers.filter((buf) => {
								if (buf.length >= count) {
									toFlush.push(buf);
									return false;
								}
								return true;
							});

							for (const buf of toFlush) {
								Object.freeze(buf);
								emit(buf);
							}
						},
						{
							onEnd: (err) => {
								if (err !== undefined) {
									buffers = [];
									error(err);
								} else {
									// Flush any partial buffers
									const remaining = buffers;
									buffers = [];
									for (const buf of remaining) {
										if (buf.length > 0) {
											Object.freeze(buf);
											emit(buf);
										}
									}
									complete();
								}
							},
						},
					);

					return () => {
						buffers = [];
						unsub();
					};
				}

				// Tumbling window: non-overlapping buffers
				let currentBuffer: A[] = [];

				const unsub = subscribe(
					input,
					(v) => {
						currentBuffer.push(v);
						if (currentBuffer.length >= count) {
							const flushed = currentBuffer;
							Object.freeze(flushed);
							currentBuffer = [];
							emit(flushed);
						}
					},
					{
						onEnd: (err) => {
							if (err !== undefined) {
								currentBuffer = [];
								error(err);
							} else {
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

				return () => {
					currentBuffer = [];
					unsub();
				};
			},
			{ initial: [] as A[] },
		);

		Inspector.register(store, { kind: "bufferCount" });
		return store;
	};
}
