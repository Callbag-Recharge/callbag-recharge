import { producer } from "../producer";
import type { ProducerStore } from "../types";

interface Observable<T> {
	subscribe(observer: { next: (value: T) => void }): { unsubscribe: () => void };
}

/**
 * Creates a source from an Observable (or any object with a
 * `.subscribe({ next })` method).
 *
 * Stateful: maintains last value via producer. get() returns the last
 * emitted value, or undefined before first emission.
 *
 * v3: Tier 2 Producer — event source, no upstream deps. Each next()
 * emission sends DIRTY on type 3 then value on type 1.
 */
export function fromObs<T>(observable: Observable<T>): ProducerStore<T> {
	return producer<T>(({ emit }) => {
		const sub = observable.subscribe({ next: emit });
		return () => sub.unsubscribe();
	});
}
