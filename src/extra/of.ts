import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";

/**
 * Synchronously emits each argument in order, then completes (Tier 2).
 *
 * @param values - Values to emit.
 *
 * @returns `ProducerStore<T>`
 *
 * @category extra
 */
export function of<T>(...values: T[]): ProducerStore<T> {
	return producer<T>(({ emit, complete }) => {
		for (const value of values) {
			emit(value);
		}
		complete();
		return undefined;
	});
}
