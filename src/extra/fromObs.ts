import { stream } from "../stream";
import type { StreamStore } from "../types";

interface Observable<T> {
	subscribe(observer: { next: (value: T) => void }): { unsubscribe: () => void };
}

/**
 * Creates a source from an Observable (or any object with a
 * `.subscribe({ next })` method).
 */
export function fromObs<T>(observable: Observable<T>): StreamStore<T> {
	return stream<T>((emit) => {
		const sub = observable.subscribe({ next: emit });
		return () => sub.unsubscribe();
	});
}
