import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";

/**
 * Emits increasing integers `0, 1, 2, …` every `ms` milliseconds (Tier 2 source).
 *
 * @param ms - Tick interval.
 *
 * @returns `ProducerStore<number>`
 *
 * @category extra
 */
export function interval(ms: number): ProducerStore<number> {
	return producer<number>(({ emit }) => {
		let i = 0;
		const id = setInterval(() => emit(i++), ms);
		return () => clearInterval(id);
	});
}
