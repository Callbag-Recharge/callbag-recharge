import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";

/**
 * Pulls async values from an `AsyncIterable` or `() => AsyncIterable` (factory for retry/repeat) (Tier 2).
 *
 * @param iterableOrFactory - Single-use iterable or factory for fresh iterators per subscribe.
 *
 * @returns `ProducerStore<T>` — aborts iteration when last sink disconnects.
 *
 * @remarks **Factory:** Prefer `() => gen()` for resubscribable sources.
 *
 * @category extra
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
