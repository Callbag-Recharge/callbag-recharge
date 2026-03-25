import { rawFromAny } from "../raw/fromAny";
import type { CallbagSource } from "../raw/subscribe";

/**
 * Deduplicates concurrent async calls by key.
 *
 * If a call for key `k` is already in flight, subsequent calls with the same key
 * join the existing callbag source instead of starting a new one. Once the source
 * completes, the key is removed and the next call starts fresh.
 *
 * @param fn - Async function keyed by the first argument.
 * @returns A wrapped function with identical signature that coalesces concurrent calls,
 *   returning a callbag source.
 *
 * @example
 * ```ts
 * import { keyedAsync } from 'callbag-recharge/utils';
 * import { rawSubscribe } from 'callbag-recharge/raw';
 *
 * const load = keyedAsync((key: string) => fetch(`/api/${key}`).then(r => r.json()));
 * // Two concurrent calls for "user:42" → one fetch, two consumers
 * rawSubscribe(load("user:42"), (data) => console.log(data));
 * rawSubscribe(load("user:42"), (data) => console.log(data));
 * ```
 *
 * @category utils
 */
export function keyedAsync<K, V>(fn: (key: K) => V | Promise<V>): (key: K) => CallbagSource {
	const inflight = new Map<K, { source: CallbagSource; refCount: number }>();
	return (key: K) => {
		const existing = inflight.get(key);
		if (existing) {
			existing.refCount++;
			return existing.source;
		}
		const source = rawFromAny(fn(key));
		// Wrap to track lifecycle and clean up when all subscribers are done
		const tracked: CallbagSource = (type: number, sink?: any) => {
			if (type !== 0) return;
			source(0, (t: number, d?: any) => {
				if (t === 0) {
					sink(0, (st: number) => {
						if (st === 2) {
							const entry = inflight.get(key);
							if (entry) {
								entry.refCount--;
								if (entry.refCount <= 0) inflight.delete(key);
							}
							d?.(2);
						}
					});
					return;
				}
				if (t === 2) {
					inflight.delete(key);
				}
				sink(t, d);
			});
		};
		inflight.set(key, { source: tracked, refCount: 1 });
		return tracked;
	};
}
