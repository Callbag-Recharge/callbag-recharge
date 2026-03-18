import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";

/**
 * Completes immediately with no DATA (Tier 2).
 *
 * @returns `ProducerStore<T>`
 *
 * @category extra
 */
export function empty<T = never>(): ProducerStore<T> {
	return producer<T>(({ complete }) => {
		complete();
		return undefined;
	});
}
