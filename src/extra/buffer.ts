import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { END, START } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";
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
 *
 * Error/completion semantics:
 * - Upstream error → forward error, discard buffer
 * - Upstream completion → flush remaining buffer (if any), then complete
 * - Notifier error → forward error, discard buffer
 * - Notifier completion → flush remaining buffer (if any), then complete
 */
export function buffer<A>(notifier: Store<unknown>): StoreOperator<A, A[]> {
	return (input: Store<A>) => {
		const store = producer<A[]>(
			({ emit, complete, error }) => {
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

				const inputUnsub = subscribe(input, (v) => {
					if (!done) currentBuffer.push(v);
				}, {
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
				});

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
						inputUnsub();
					}
				});

				return () => {
					done = true;
					if (notifierTalkback) notifierTalkback(END);
					notifierTalkback = null;
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
