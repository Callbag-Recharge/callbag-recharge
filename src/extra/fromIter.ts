import { stream } from "../stream";
import type { StreamStore } from "../types";

/**
 * Creates a source from a synchronous iterable.
 * Values are emitted synchronously when the pipeline is subscribed to.
 */
export function fromIter<T>(iterable: Iterable<T>): StreamStore<T> {
	return stream<T>((emit, _request, complete) => {
		for (const value of iterable) {
			emit(value);
		}
		complete();
		return undefined;
	});
}
