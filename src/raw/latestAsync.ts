// ---------------------------------------------------------------------------
// latestAsync — stale-result guard for async functions
// ---------------------------------------------------------------------------
// Wraps an async function so that only the result of the *most recent* call
// is delivered. Earlier in-flight results are silently discarded. Cancelling
// invalidates all pending calls without aborting the underlying Promise.
//
// This is the raw equivalent of the generation-counter pattern used in
// cancellableAction — but with zero store/core dependencies so it can be
// used anywhere (ai/, utils/, orchestrate/, etc.).
//
// Usage:
//   const latest = latestAsync((query: string) => embed(query));
//   latest.call('hello', result => doSomething(result), err => handleErr(err));
//   latest.call('world', result => doSomething(result)); // 'hello' discarded
//   latest.cancel(); // invalidates any remaining in-flight call
// ---------------------------------------------------------------------------

/**
 * Wraps an async function so that only the result of the most recent
 * invocation is delivered. Stale results from earlier calls are discarded.
 *
 * Use `cancel()` to invalidate all in-flight calls (e.g. on destroy). If
 * `onError` is omitted, errors from the latest call are silently dropped.
 *
 * No core dependencies — safe to import from any layer.
 *
 * @param fn - The async function to wrap.
 *
 * @returns An object with `call(input, onResult, onError?)` and `cancel()`.
 *
 * @example
 * ```ts
 * import { latestAsync } from 'callbag-recharge/raw';
 *
 * const latest = latestAsync((query: string) => embed(query));
 *
 * // Only the result of the last call is delivered
 * latest.call('hello', result => console.log(result));
 * latest.call('world', result => console.log(result)); // 'hello' discarded
 *
 * // Invalidate all in-flight calls (e.g. on component destroy)
 * latest.cancel();
 * ```
 *
 * @category raw
 */
export function latestAsync<TInput, TResult>(
	fn: (input: TInput) => Promise<TResult>,
): {
	/**
	 * Invoke `fn` with `input`. If this is the most recent call when the
	 * Promise settles, `onResult` (or `onError`) is called. Otherwise the
	 * result is silently dropped.
	 */
	call(input: TInput, onResult: (result: TResult) => void, onError?: (err: unknown) => void): void;
	/** Discard all pending in-flight results. */
	cancel(): void;
} {
	let generation = 0;

	return {
		call(input, onResult, onError) {
			const gen = ++generation;
			fn(input).then(
				(result) => {
					if (gen === generation) onResult(result);
				},
				(err) => {
					if (gen === generation) onError?.(err);
				},
			);
		},
		cancel() {
			generation++;
		},
	};
}
