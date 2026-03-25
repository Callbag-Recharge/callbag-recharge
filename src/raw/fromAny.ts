// ---------------------------------------------------------------------------
// rawFromAny — universal value → raw callbag source
// ---------------------------------------------------------------------------
// Dispatches: PromiseLike → rawFromPromise, AsyncIterable → rawFromAsyncIter,
// Iterable (non-string) → sync emit all + END, plain value → emit once + END.
// No Observable support (that stays in extra/fromAny).
// Zero core deps — pure callbag protocol.
// ---------------------------------------------------------------------------

import { rawFromAsyncIter } from "./fromAsyncIter";
import { rawFromPromise } from "./fromPromise";
import type { CallbagSource } from "./subscribe";

function isPromiseLike(x: unknown): x is PromiseLike<unknown> {
	return x != null && typeof (x as any).then === "function";
}

function isAsyncIterable<T>(x: unknown): x is AsyncIterable<T> {
	return x != null && typeof (x as any)[Symbol.asyncIterator] === "function";
}

function isIterable<T>(x: unknown): x is Iterable<T> {
	return x != null && typeof (x as any)[Symbol.iterator] === "function";
}

/**
 * Normalizes any value into a raw callbag source that emits value(s) then completes.
 *
 * Dispatch order:
 * 1. **PromiseLike** — delegates to `rawFromPromise`
 * 2. **AsyncIterable** — delegates to `rawFromAsyncIter`
 * 3. **Iterable** (non-string) — emits each element synchronously, then END
 * 4. **Plain value** — emits once, then END
 *
 * @param input - Any value, promise, iterable, or async iterable.
 *
 * @returns A raw callbag source function.
 *
 * @category raw
 */
export function rawFromAny<T>(
	input: T | PromiseLike<T> | Iterable<T> | AsyncIterable<T>,
): CallbagSource {
	// 1. PromiseLike
	if (isPromiseLike(input)) {
		return rawFromPromise(input as PromiseLike<T>);
	}

	// 2. AsyncIterable
	if (isAsyncIterable<T>(input)) {
		return rawFromAsyncIter(input as AsyncIterable<T>);
	}

	// 3. Iterable (exclude strings — treat as plain value)
	if (typeof input !== "string" && isIterable<T>(input)) {
		return (type: number, sink?: any) => {
			if (type !== 0 /* START */) return;

			let cancelled = false;

			sink(0 /* START */, (t: number) => {
				if (t === 2 /* END */) {
					cancelled = true;
				}
			});

			for (const value of input as Iterable<T>) {
				if (cancelled) return;
				sink(1 /* DATA */, value);
			}
			if (!cancelled) {
				sink(2 /* END */);
			}
		};
	}

	// 4. Plain value
	return (type: number, sink?: any) => {
		if (type !== 0 /* START */) return;

		let cancelled = false;

		sink(0 /* START */, (t: number) => {
			if (t === 2 /* END */) {
				cancelled = true;
			}
		});

		if (!cancelled) {
			sink(1 /* DATA */, input);
		}
		if (!cancelled) {
			sink(2 /* END */);
		}
	};
}
