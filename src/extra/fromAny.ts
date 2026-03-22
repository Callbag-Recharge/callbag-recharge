import { producer } from "../core/producer";
import type { ProducerStore } from "../core/types";

interface Observable<T> {
	subscribe(observer: {
		next: (value: T) => void;
		error?: (err: unknown) => void;
		complete?: () => void;
	}): { unsubscribe: () => void };
}

function isPromiseLike(x: unknown): x is PromiseLike<unknown> {
	return x != null && typeof (x as any).then === "function";
}

function isObservable<T>(x: unknown): x is Observable<T> {
	return x != null && typeof (x as any).subscribe === "function";
}

function isAsyncIterable<T>(x: unknown): x is AsyncIterable<T> {
	return x != null && typeof (x as any)[Symbol.asyncIterator] === "function";
}

function isIterable<T>(x: unknown): x is Iterable<T> {
	return x != null && typeof (x as any)[Symbol.iterator] === "function";
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
	// 1. Promise
	if (isPromiseLike(input)) {
		return producer<T>(({ emit, complete, error }) => {
			let cancelled = false;
			(input as PromiseLike<T>).then(
				(value) => {
					if (!cancelled) {
						emit(value);
						complete();
					}
				},
				(reason) => {
					if (!cancelled) error(reason);
				},
			);
			return () => {
				cancelled = true;
			};
		});
	}

	// 2. Observable
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

	// 3. AsyncIterable
	if (isAsyncIterable<T>(input)) {
		return producer<T>(
			({ emit, complete, error }) => {
				const controller = new AbortController();
				const signal = controller.signal;
				let done = false;

				const iterator = (input as AsyncIterable<T>)[Symbol.asyncIterator]();

				async function pull() {
					try {
						while (!done && !signal.aborted) {
							const result = await iterator.next();
							if (done || signal.aborted) break;
							if (result.done) {
								complete();
								return;
							}
							emit(result.value);
						}
					} catch (err) {
						if (!done && !signal.aborted) error(err);
					}
				}

				pull();

				return () => {
					done = true;
					controller.abort();
					Promise.resolve(iterator.return?.()).catch(() => {});
				};
			},
			{ resubscribable: true },
		);
	}

	// 4. Iterable (exclude strings — treat as plain value)
	if (typeof input !== "string" && isIterable<T>(input)) {
		return producer<T>(({ emit, complete }) => {
			for (const value of input as Iterable<T>) {
				emit(value);
			}
			complete();
			return undefined;
		});
	}

	// 5. Plain value
	return producer<T>(({ emit, complete }) => {
		emit(input as T);
		complete();
		return undefined;
	});
}
