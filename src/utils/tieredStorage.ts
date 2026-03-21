// ---------------------------------------------------------------------------
// tieredStorage — composes two CheckpointAdapters into one
// ---------------------------------------------------------------------------
// Reads check hot first, fall back to cold. Writes go to hot; eviction
// policy controls when entries are demoted to cold. Pluggable eviction
// (default: LRU) reuses the existing EvictionPolicy<string> interface.
//
// Usage:
//   const adapter = tieredStorage(memoryAdapter(), fileAdapter({ dir: ".cache" }), {
//     maxHotSize: 100,
//     eviction: lru(),
//   });
//   adapter.save("key", value); // saved to hot
//   adapter.load("key");        // reads hot first, falls back to cold
// ---------------------------------------------------------------------------

import type { CheckpointAdapter } from "./checkpoint";
import type { EvictionPolicy } from "./eviction";
import { lru } from "./eviction";

export interface TieredStorageOptions {
	/** Max entries in hot tier before eviction. 0 = no limit (default). */
	maxHotSize?: number;
	/** Eviction policy for hot tier. Default: LRU. Only used when maxHotSize > 0. */
	eviction?: EvictionPolicy<string>;
}

export interface TieredStorageAdapter extends CheckpointAdapter {
	/** Manually promote a key from cold to hot. */
	promote(id: string): void | Promise<void>;
	/** Manually demote a key from hot to cold. */
	demote(id: string): void | Promise<void>;
}

/** Safely handle a potentially async operation (fire-and-forget). */
function fireAndForget(result: void | Promise<void>): void {
	if (result instanceof Promise) {
		result.catch(() => {});
	}
}

/**
 * Compose two `CheckpointAdapter`s into a tiered storage adapter.
 *
 * @param hot - Fast-access adapter (e.g., memoryAdapter, in-process cache).
 * @param cold - Durable adapter (e.g., fileAdapter, sqliteAdapter).
 * @param opts - Optional configuration.
 *
 * @returns `TieredStorageAdapter` — a CheckpointAdapter with `promote()` and `demote()` methods.
 *
 * @remarks **Read path:** Hot first, fall back to cold. On cold hit, auto-promotes to hot (which may trigger eviction/demotion of another key).
 * @remarks **Write path:** Always writes to hot. If `maxHotSize` is set and hot tier exceeds limit, eviction policy selects keys to demote to cold.
 * @remarks **Eviction:** Uses `EvictionPolicy<string>` (default: LRU). Tracks access via `touch()` on reads, `insert()` on writes. Evicted keys are demoted to cold (fire-and-forget).
 * @remarks **Manual control:** `promote(id)` copies cold→hot, `demote(id)` copies hot→cold then clears hot.
 *
 * @example
 * ```ts
 * import { tieredStorage, memoryAdapter, lru } from 'callbag-recharge/utils';
 * import { fileAdapter } from 'callbag-recharge/utils';
 *
 * const adapter = tieredStorage(
 *   memoryAdapter(),
 *   fileAdapter({ dir: ".cache" }),
 *   { maxHotSize: 50, eviction: lru() },
 * );
 * adapter.save("key", { data: 42 }); // → hot tier
 * adapter.load("key");               // → hot hit
 * ```
 *
 * @category utils
 */
export function tieredStorage(
	hot: CheckpointAdapter,
	cold: CheckpointAdapter,
	opts?: TieredStorageOptions,
): TieredStorageAdapter {
	const maxHotSize = opts?.maxHotSize ?? 0;
	const policy = maxHotSize > 0 ? (opts?.eviction ?? lru<string>()) : null;

	/**
	 * Demote evicted keys from hot to cold (fire-and-forget).
	 * Called after a new key is inserted when hot tier exceeds maxHotSize.
	 */
	function evictFromHot(): void {
		if (!policy || maxHotSize <= 0) return;
		while (policy.size() > maxHotSize) {
			const victims = policy.evict(1);
			if (victims.length === 0) break;
			for (const id of victims) {
				// Load from hot, save to cold, then clear hot.
				// Chain clear after save to prevent data loss on async cold.save failure.
				const val = hot.load(id);
				if (val instanceof Promise) {
					val
						.then((v) => {
							if (v !== undefined) {
								const saveResult = cold.save(id, v);
								if (saveResult instanceof Promise) {
									saveResult.then(() => fireAndForget(hot.clear(id))).catch(() => {});
									return;
								}
							}
							fireAndForget(hot.clear(id));
						})
						.catch(() => {});
				} else {
					if (val !== undefined) {
						const saveResult = cold.save(id, val);
						if (saveResult instanceof Promise) {
							saveResult.then(() => fireAndForget(hot.clear(id))).catch(() => {});
							continue;
						}
					}
					fireAndForget(hot.clear(id));
				}
			}
		}
	}

	return {
		save(id: string, value: unknown): void | Promise<void> {
			const result = hot.save(id, value);
			if (policy) {
				policy.insert(id);
				evictFromHot();
			}
			return result;
		},

		load(id: string): unknown | undefined | Promise<unknown | undefined> {
			const hotVal = hot.load(id);

			if (hotVal instanceof Promise) {
				return hotVal.then((v) => {
					if (v !== undefined) {
						policy?.touch(id);
						return v;
					}
					// Fall back to cold
					return Promise.resolve(cold.load(id)).then((coldVal) => {
						if (coldVal !== undefined) {
							// Auto-promote to hot
							fireAndForget(hot.save(id, coldVal));
							if (policy) {
								policy.insert(id);
								evictFromHot();
							}
						}
						return coldVal;
					});
				});
			}

			// Sync hot path
			if (hotVal !== undefined) {
				policy?.touch(id);
				return hotVal;
			}

			// Fall back to cold
			const coldVal = cold.load(id);
			if (coldVal instanceof Promise) {
				return coldVal.then((v) => {
					if (v !== undefined) {
						fireAndForget(hot.save(id, v));
						if (policy) {
							policy.insert(id);
							evictFromHot();
						}
					}
					return v;
				});
			}

			if (coldVal !== undefined) {
				fireAndForget(hot.save(id, coldVal));
				if (policy) {
					policy.insert(id);
					evictFromHot();
				}
			}
			return coldVal;
		},

		clear(id: string): void | Promise<void> {
			policy?.delete(id);
			const r1 = hot.clear(id);
			const r2 = cold.clear(id);
			if (r1 instanceof Promise || r2 instanceof Promise) {
				return Promise.all([
					r1 instanceof Promise ? r1 : Promise.resolve(),
					r2 instanceof Promise ? r2 : Promise.resolve(),
				]).then(() => {});
			}
		},

		promote(id: string): void | Promise<void> {
			const coldVal = cold.load(id);
			if (coldVal instanceof Promise) {
				return coldVal.then((v) => {
					if (v === undefined) return;
					const saveResult = hot.save(id, v);
					if (policy) {
						policy.insert(id);
						evictFromHot();
					}
					if (saveResult instanceof Promise) return saveResult.then(() => {});
				});
			}
			if (coldVal !== undefined) {
				const saveResult = hot.save(id, coldVal);
				if (policy) {
					policy.insert(id);
					evictFromHot();
				}
				if (saveResult instanceof Promise) return saveResult.then(() => {});
			}
		},

		demote(id: string): void | Promise<void> {
			policy?.delete(id);
			const hotVal = hot.load(id);
			if (hotVal instanceof Promise) {
				return hotVal.then((v) => {
					if (v !== undefined) {
						const saveResult = cold.save(id, v);
						if (saveResult instanceof Promise) {
							return saveResult.then(() => fireAndForget(hot.clear(id)));
						}
					}
					fireAndForget(hot.clear(id));
				});
			}
			if (hotVal !== undefined) {
				const saveResult = cold.save(id, hotVal);
				if (saveResult instanceof Promise) {
					return saveResult.then(() => fireAndForget(hot.clear(id)));
				}
				fireAndForget(hot.clear(id));
			}
			// Key not in hot — no-op
		},
	};
}
