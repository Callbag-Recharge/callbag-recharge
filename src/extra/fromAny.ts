import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";
import { rawFromAny } from "../raw/fromAny";
import { rawSubscribe } from "../raw/subscribe";

interface Observable<T> {
	subscribe(observer: {
		next: (value: T) => void;
		error?: (err: unknown) => void;
		complete?: () => void;
	}): { unsubscribe: () => void };
}

function isObservable<T>(x: unknown): x is Observable<T> {
	return x != null && typeof (x as any).subscribe === "function";
}

/**
 * Normalizes any value type into a callbag `ProducerStore` that emits value(s) then completes.
 *
 * Supported inputs (checked in order):
 * 1. **Promise / PromiseLike** — emits resolved value, errors on reject
 * 2. **Observable** (`{ subscribe }`) — bridges next/error/complete
 * 3. **AsyncIterable** — pulls values, aborts on cleanup
 * 4. **Iterable** (excluding strings) — emits each element synchronously
 * 5. **Plain value** — emits once, completes
 *
 * @param input - Any value, promise, iterable, async iterable, or observable.
 *
 * @returns `ProducerStore<T>`
 *
 * @example
 * ```ts
 * import { fromAny } from 'callbag-recharge/extra';
 *
 * fromAny(42);                        // emits 42
 * fromAny(fetch('/api').then(r => r.json())); // emits response
 * fromAny([1, 2, 3]);                 // emits 1, 2, 3
 * fromAny(asyncGenerator());          // emits each yielded value
 * fromAny(rxjsObservable$);           // bridges observable
 * ```
 *
 * @category extra
 */
export function fromAny<T>(
	input: T | Promise<T> | Iterable<T> | AsyncIterable<T>,
): ProducerStore<T> {
	// Observable — extra-only (raw/ doesn't support Observable)
	if (isObservable<T>(input)) {
		return producer<T>(({ emit, complete, error }) => {
			let cancelled = false;
			const sub = (input as Observable<T>).subscribe({
				next: (v) => {
					if (!cancelled) emit(v);
				},
				error: (err) => {
					if (!cancelled) error(err);
				},
				complete: () => {
					if (!cancelled) complete();
				},
			});
			return () => {
				cancelled = true;
				sub.unsubscribe();
			};
		});
	}

	// Everything else delegates to rawFromAny → producer wrapper
	return producer<T>(
		({ emit, complete, error }) => {
			const sub = rawSubscribe(rawFromAny(input), (value) => emit(value as T), {
				onEnd: (err) => (err !== undefined ? error(err) : complete()),
			});
			return () => sub.unsubscribe();
		},
		{ resubscribable: true },
	);
}
