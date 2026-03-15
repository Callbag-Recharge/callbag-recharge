import { producer } from "../producer";
import type { ProducerStore } from "../types";

/**
 * Creates a source that emits a single value when the promise resolves.
 *
 * Stateful: maintains resolved value via producer. get() returns undefined
 * before resolution, then the resolved value.
 *
 * v3: Tier 2 Producer — event source, no upstream deps. emit() sends DIRTY
 * then the resolved value on type 1, then complete() sends END.
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
