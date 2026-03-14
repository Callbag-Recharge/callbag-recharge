import { producer } from "../producer";
import type { ProducerStore } from "../types";

/**
 * Creates a push-based source that emits incrementing integers (0, 1, 2, ...)
 * every `ms` milliseconds.
 *
 * Tier 2 Producer: event source, no upstream deps.
 *
 * v3: uses producer() with autoDirty:true (default) — each emit automatically
 * sends DIRTY on type 3 before the value on type 1.
 */
export function interval(ms: number): ProducerStore<number> {
	return producer<number>(({ emit }) => {
		let i = 0;
		const id = setInterval(() => emit(i++), ms);
		return () => clearInterval(id);
	});
}
