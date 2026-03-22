/**
 * Deduplicates concurrent async calls by key.
 *
 * If a call for key `k` is already in flight, subsequent calls with the same key
 * join the existing promise instead of starting a new one. Once the promise settles,
 * the key is removed and the next call starts fresh.
 *
 * @param fn - Async function keyed by the first argument.
 * @returns A wrapped function with identical signature that coalesces concurrent calls.
 *
 * @example
 * ```ts
 * import { keyedAsync } from 'callbag-recharge/utils';
 *
 * const load = keyedAsync((key: string) => fetch(`/api/${key}`).then(r => r.json()));
 * // Two concurrent calls for "user:42" → one fetch, two consumers
 * const [a, b] = await Promise.all([load("user:42"), load("user:42")]);
 * ```
 *
 * @category utils
 */
export function keyedAsync<K, V>(fn: (key: K) => Promise<V>): (key: K) => Promise<V> {
	const inflight = new Map<K, Promise<V>>();
	return (key: K) => {
		const existing = inflight.get(key);
		if (existing) return existing;
		const p = fn(key).finally(() => inflight.delete(key));
		inflight.set(key, p);
		return p;
	};
}
