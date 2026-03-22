import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";

export interface IntervalOptions {
	/** If true, call `.unref()` on the timer so it doesn't keep the Node.js process alive. */
	unref?: boolean;
}

/**
 * Emits increasing integers `0, 1, 2, …` every `ms` milliseconds (Tier 2 source).
 *
 * @param ms - Tick interval.
 * @param opts - Optional configuration.
 *
 * @returns `ProducerStore<number>`
 *
 * @category extra
 */
export function interval(ms: number, opts?: IntervalOptions): ProducerStore<number> {
	return producer<number>(({ emit }) => {
		let i = 0;
		const id = setInterval(() => emit(i++), ms);
		if (opts?.unref && typeof id === "object" && "unref" in id) {
			id.unref();
		}
		return () => clearInterval(id);
	});
}
