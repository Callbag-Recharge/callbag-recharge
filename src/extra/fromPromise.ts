import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";

/**
 * Emits the promise’s resolved value once then completes; rejections become stream errors (Tier 2).
 *
 * @param promise - The promise to adapt.
 *
 * @returns `ProducerStore<T>`
 *
 * @category extra
 */
export function fromPromise<T>(promise: Promise<T>): ProducerStore<T> {
	return producer<T>(({ emit, complete, error }) => {
		let cancelled = false;
		promise.then(
			(value) => {
				if (!cancelled) {
					emit(value);
					complete();
				}
			},
			(reason) => {
				if (!cancelled) {
					error(reason);
				}
			},
		);
		return () => {
			cancelled = true;
		};
	});
}
