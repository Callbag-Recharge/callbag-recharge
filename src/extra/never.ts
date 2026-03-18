import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";

/**
 * Inert source: never emits, completes, or errors (Tier 2).
 *
 * @returns `ProducerStore<T>`
 *
 * @category extra
 */
export function never<T = never>(): ProducerStore<T> {
	return producer<T>(() => {
		return undefined;
	});
}
