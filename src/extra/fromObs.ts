import { producer } from "../producer";
import type { ProducerStore } from "../types";

interface Observable<T> {
	subscribe(observer: { next: (value: T) => void }): { unsubscribe: () => void };
}

/**
 * Creates a source from an Observable (or any object with a
 * `.subscribe({ next })` method).
 *
 * Tier 2 Producer: event source, no upstream deps.
 *
 * v3: uses producer() — each next() emission sends DIRTY then value.
 */
export function fromObs<T>(observable: Observable<T>): ProducerStore<T> {
	return producer<T>(({ emit }) => {
		const sub = observable.subscribe({ next: emit });
		return () => sub.unsubscribe();
	});
}
