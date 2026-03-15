import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";

/**
 * Creates a source that emits a single value when the promise resolves,
 * or forwards the rejection as an error.
 *
 * Stateful: maintains resolved value via producer. get() returns undefined
 * before resolution, then the resolved value.
 *
 * v3: Tier 2 Producer — event source, no upstream deps. emit() sends DIRTY
 * then the resolved value on type 1, then complete() sends END.
 * Rejection calls error() to forward the rejection reason.
 */
export function fromPromise<T>(promise: Promise<T>): ProducerStore<T> {
	return producer<T>(({ emit, complete, error }) => {
		let cancelled = false;
		promise.then(
			(value) => {
				if (!cancelled) {
					emit(value);
					complete();
				}
			},
			(reason) => {
				if (!cancelled) {
					error(reason);
				}
			},
		);
		return () => {
			cancelled = true;
		};
	});
}
