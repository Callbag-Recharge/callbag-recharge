import { stream } from "../stream";
import type { StreamStore } from "../types";

/**
 * Creates a source that emits a single value when the promise resolves.
 */
export function fromPromise<T>(promise: Promise<T>): StreamStore<T> {
	return stream<T>((emit, _request, complete) => {
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
