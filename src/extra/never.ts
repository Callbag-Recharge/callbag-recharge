import { producer } from "../producer";
import type { ProducerStore } from "../types";

/**
 * Creates a source that never emits, never errors, and never completes.
 *
 * Stateful: get() always returns undefined — no values are ever emitted.
 *
 * v3: Tier 2 Producer — starts but never calls emit/complete/error.
 * Cleanup function is a no-op. Tests verify no leaks from idle sources.
 */
export function never<T = never>(): ProducerStore<T> {
	return producer<T>(() => {
		return undefined;
	});
}
