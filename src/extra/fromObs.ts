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
 * Bridges a minimal Observable shape (`subscribe({ next, error, complete })`) into a store (Tier 2).
 *
 * @param observable - Any object with that subscribe API (e.g. RxJS Observable).
 *
 * @returns `ProducerStore<T>`
 *
 * @category extra
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
