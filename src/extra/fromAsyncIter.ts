import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";
import { rawFromAsyncIter } from "../raw/fromAsyncIter";
import { rawSubscribe } from "../raw/subscribe";

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
			const sub = rawSubscribe(rawFromAsyncIter(iterableOrFactory), (value) => emit(value as T), {
				onEnd: (err) => (err !== undefined ? error(err) : complete()),
			});
			return () => sub.unsubscribe();
		},
		{ resubscribable: true },
	);

	Inspector.register(store, { kind: "fromAsyncIter" });
	return store;
}
