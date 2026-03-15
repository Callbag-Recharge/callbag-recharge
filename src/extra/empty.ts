import { producer } from "../producer";
import type { ProducerStore } from "../types";

/**
 * Creates a source that completes immediately without emitting any values.
 *
 * Stateful: get() always returns undefined — no values are ever emitted.
 *
 * v3: Tier 2 Producer — sends END immediately on start. Tests validate
 * that END propagation works with no preceding DATA.
 */
export function empty<T = never>(): ProducerStore<T> {
	return producer<T>(({ complete }) => {
		complete();
		return undefined;
	});
}
