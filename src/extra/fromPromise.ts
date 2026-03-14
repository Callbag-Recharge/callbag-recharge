import { producer } from "../producer";
import type { ProducerStore } from "../types";

/**
 * Creates a source that emits a single value when the promise resolves.
 *
 * Tier 2 Producer: event source, no upstream deps.
 *
 * v3: uses producer() — emit() sends DIRTY then the resolved value, then
 * complete() sends END.
 */
export function fromPromise<T>(promise: Promise<T>): ProducerStore<T> {
	return producer<T>(({ emit, complete }) => {
		let cancelled = false;
		promise.then(
			(value) => {
				if (!cancelled) {
					emit(value);
					complete();
				}
			},
			() => {}, // prevent unhandled rejection
		);
		return () => {
			cancelled = true;
		};
	});
}
