import { producer } from "../producer";
import type { ProducerStore } from "../types";

/**
 * Creates a source from a synchronous iterable.
 * Values are emitted synchronously when the pipeline is subscribed to.
 *
 * Stateful: maintains last value via producer. get() returns the last
 * emitted value (the final iterable element after start).
 *
 * v3: Tier 2 Producer — event source, no upstream deps. Each emit() sends
 * DIRTY on type 3 then the value on type 1, synchronously.
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
