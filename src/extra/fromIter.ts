import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";

/**
 * Emits all elements of a synchronous iterable then completes (Tier 2).
 *
 * @param iterable - Values to push on subscribe.
 *
 * @returns `ProducerStore<T>`
 *
 * @category extra
 */
export function fromIter<T>(iterable: Iterable<T>): ProducerStore<T> {
	return producer<T>(({ emit, complete }) => {
		for (const value of iterable) {
			emit(value);
		}
		complete();
		return undefined;
	});
}
