import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";
import { rawFromPromise } from "../raw/fromPromise";
import { rawSubscribe } from "../raw/subscribe";

/**
 * Emits the promise's resolved value once then completes; rejections become stream errors (Tier 2).
 *
 * @param promise - The promise to adapt.
 *
 * @returns `ProducerStore<T>`
 *
 * @category extra
 */
export function fromPromise<T>(promise: Promise<T>): ProducerStore<T> {
	return producer<T>(({ emit, complete, error }) => {
		const sub = rawSubscribe(rawFromPromise(promise), (value) => emit(value as T), {
			onEnd: (err) => (err !== undefined ? error(err) : complete()),
		});
		return () => sub.unsubscribe();
	});
}
