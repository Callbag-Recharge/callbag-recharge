import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { END, RESET, START } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Collects upstream values into arrays, flushing each buffer when `notifier` emits (Tier 2).
 *
 * @param notifier - Any store whose emissions trigger a flush.
 *
 * @returns `StoreOperator<A, A[]>` — `get()` returns last flushed array (empty before first flush).
 *
 * @remarks **End:** Upstream or notifier completion flushes remaining items when applicable.
 *
 * @seeAlso [bufferCount](/api/bufferCount), [bufferTime](/api/bufferTime)
 *
 * @category extra
 */
export function buffer<A>(notifier: Store<unknown>): StoreOperator<A, A[]> {
	return (input: Store<A>) => {
		const store = producer<A[]>(
			({ emit, complete, error, onSignal }) => {
				let currentBuffer: A[] = [];
				let done = false;

				function flushAndComplete() {
					if (done) return;
					done = true;
					if (currentBuffer.length > 0) {
						const flushed = currentBuffer;
						Object.freeze(flushed);
						currentBuffer = [];
						emit(flushed);
					}
					complete();
				}

				function forwardError(err: unknown) {
					if (done) return;
					done = true;
					currentBuffer = [];
					error(err);
				}

				const inputUnsub = subscribe(
					input,
					(v) => {
						if (!done) currentBuffer.push(v);
					},
					{
						onEnd: (err) => {
							if (err !== undefined) {
								forwardError(err);
							} else {
								flushAndComplete();
							}
							// Clean up notifier
							if (notifierTalkback) {
								notifierTalkback(END);
								notifierTalkback = null;
							}
						},
					},
				);

				let notifierTalkback: ((type: number) => void) | null = null;
				notifier.source(START, (type: number, data: unknown) => {
					if (type === START) notifierTalkback = data as (type: number) => void;
					if (type === 1 && !done && currentBuffer.length > 0) {
						const flushed = currentBuffer;
						Object.freeze(flushed);
						currentBuffer = [];
						emit(flushed);
					}
					if (type === END) {
						notifierTalkback = null;
						if (data !== undefined) {
							forwardError(data);
						} else {
							flushAndComplete();
						}
						// Clean up input
						inputUnsub.unsubscribe();
					}
				});

				onSignal((s) => {
					inputUnsub.signal(s);
					if (s === RESET) {
						currentBuffer = [];
					}
				});

				return () => {
					done = true;
					if (notifierTalkback) notifierTalkback(END);
					notifierTalkback = null;
					currentBuffer = [];
					inputUnsub.unsubscribe();
				};
			},
			{ initial: [] as A[] },
		);

		Inspector.register(store, { kind: "buffer" });
		return store;
	};
}
