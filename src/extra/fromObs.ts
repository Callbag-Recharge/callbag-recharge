import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";

interface Observable<T> {
	subscribe(observer: {
		next: (value: T) => void;
		error?: (err: unknown) => void;
		complete?: () => void;
	}): { unsubscribe: () => void };
}

/**
 * Creates a source from an Observable (or any object with a
 * `.subscribe({ next, error, complete })` method).
 *
 * Stateful: maintains last value via producer. get() returns the last
 * emitted value, or undefined before first emission.
 *
 * v3: Tier 2 Producer — event source, no upstream deps. Each next()
 * emission sends DIRTY on type 3 then value on type 1. Observable
 * error and complete are forwarded to downstream subscribers.
 */
export function fromObs<T>(observable: Observable<T>): ProducerStore<T> {
	return producer<T>(({ emit, complete, error }) => {
		const sub = observable.subscribe({
			next: emit,
			error: (err) => error(err),
			complete: () => complete(),
		});
		return () => sub.unsubscribe();
	});
}
