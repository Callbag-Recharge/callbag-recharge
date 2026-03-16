import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";

/**
 * Creates a source from an AsyncIterable or a factory that returns one.
 * Values are emitted as they arrive from the async iterator.
 *
 * Tier 2: each yielded value starts a new DIRTY+value cycle (autoDirty: true).
 * Supports cancellation via AbortController when last sink leaves.
 *
 * **Resubscription:** For use with `retry`/`repeat`, pass a factory function
 * `() => AsyncIterable<T>`. A raw `AsyncIterable` is consumed once — many
 * async generators return `this` from `[Symbol.asyncIterator]()`, so
 * resubscribing after exhaustion yields no values. The factory form creates
 * a fresh iterable on each subscription.
 */
export function fromAsyncIter<T>(
	iterableOrFactory: AsyncIterable<T> | (() => AsyncIterable<T>),
): ProducerStore<T> {
	const store = producer<T>(
		({ emit, complete, error }) => {
			const controller = new AbortController();
			const signal = controller.signal;
			let done = false;

			const iterable =
				typeof iterableOrFactory === "function" ? iterableOrFactory() : iterableOrFactory;

			const iterator = iterable[Symbol.asyncIterator]();

			async function pull() {
				try {
					while (!done && !signal.aborted) {
						const result = await iterator.next();
						if (done || signal.aborted) break;
						if (result.done) {
							complete();
							return;
						}
						emit(result.value);
					}
				} catch (err) {
					if (!done && !signal.aborted) {
						error(err);
					}
				}
			}

			pull();

			return () => {
				done = true;
				controller.abort();
				// Best-effort cleanup: call iterator.return() if available.
				// Catch rejected promise to prevent unhandled rejection.
				Promise.resolve(iterator.return?.()).catch(() => {});
			};
		},
		{ resubscribable: true },
	);

	Inspector.register(store, { kind: "fromAsyncIter" });
	return store;
}
