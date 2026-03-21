import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { RESET } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Flushes every `count` values as an array; optional `startEvery` enables overlapping (sliding) buffers.
 *
 * @param count - Buffer size before flush.
 * @param startEvery - If set, start a new buffer every N emissions (sliding); omit for tumbling windows.
 *
 * @returns `StoreOperator<A, A[]>` — Tier 2.
 *
 * @category extra
 */
export function bufferCount<A>(count: number, startEvery?: number): StoreOperator<A, A[]> {
	return (input: Store<A>) => {
		const store = producer<A[]>(
			({ emit, error, complete, onSignal }) => {
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

					onSignal((s) => {
						unsub.signal(s);
						if (s === RESET) {
							buffers = [];
							emitCount = 0;
						}
					});

					return () => {
						buffers = [];
						unsub.unsubscribe();
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

				onSignal((s) => {
					unsub.signal(s);
					if (s === RESET) {
						currentBuffer = [];
					}
				});

				return () => {
					currentBuffer = [];
					unsub.unsubscribe();
				};
			},
			{ initial: [] as A[] },
		);

		Inspector.register(store, { kind: "bufferCount" });
		return store;
	};
}
