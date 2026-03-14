import { producer } from "../producer";
import type { ProducerStore } from "../types";

/**
 * Creates a source from a synchronous iterable.
 * Values are emitted synchronously when the pipeline is subscribed to.
 *
 * Tier 2 Producer: event source, no upstream deps.
 *
 * v3: uses producer() — each emit() sends DIRTY then the value synchronously.
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
