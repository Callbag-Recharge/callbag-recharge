// ---------------------------------------------------------------------------
// rawFromAsyncIter — AsyncIterable → raw callbag source
// ---------------------------------------------------------------------------
// Pulls values from an AsyncIterable (or factory), emits each as DATA,
// completes with END on done. Errors become END with error.
// Zero core deps — pure callbag protocol.
// ---------------------------------------------------------------------------

import type { CallbagSource } from "./subscribe";

/**
 * Converts an `AsyncIterable<T>` (or factory) into a raw callbag source.
 * Emits each yielded value as DATA, then END on completion.
 *
 * Factory form `() => AsyncIterable<T>` creates a fresh iterator per
 * subscriber — use for resubscribable sources.
 *
 * @param iterableOrFactory - Single-use iterable or factory for fresh iterators.
 *
 * @returns A raw callbag source function.
 *
 * @category raw
 */
export function rawFromAsyncIter<T>(
	iterableOrFactory: AsyncIterable<T> | (() => AsyncIterable<T>),
): CallbagSource {
	return (type: number, sink?: any) => {
		if (type !== 0 /* START */) return;

		const controller = new AbortController();
		const signal = controller.signal;
		let done = false;

		let iterable: AsyncIterable<T>;
		let iterator: AsyncIterator<T>;
		try {
			iterable = typeof iterableOrFactory === "function" ? iterableOrFactory() : iterableOrFactory;
			iterator = iterable[Symbol.asyncIterator]();
		} catch (err) {
			// Factory or Symbol.asyncIterator access threw — deliver as protocol error
			sink(0 /* START */, () => {});
			sink(2 /* END */, err);
			return;
		}

		// Talkback: sink can send END to cancel
		sink(0 /* START */, (t: number) => {
			if (t === 2 /* END */ && !done) {
				done = true;
				controller.abort();
				// Best-effort cleanup
				Promise.resolve(iterator.return?.()).catch(() => {});
			}
		});

		async function pull() {
			try {
				while (!done && !signal.aborted) {
					const result = await iterator.next();
					if (done || signal.aborted) break;
					if (result.done) {
						done = true;
						sink(2 /* END */);
						return;
					}
					sink(1 /* DATA */, result.value);
				}
			} catch (err) {
				if (!done && !signal.aborted) {
					done = true;
					sink(2 /* END */, err);
				}
			}
		}

		pull();
	};
}
