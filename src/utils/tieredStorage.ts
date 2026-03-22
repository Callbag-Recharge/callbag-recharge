// ---------------------------------------------------------------------------
// tieredStorage — reactive tiered cache backed by CheckpointAdapters
// ---------------------------------------------------------------------------
// Wraps N CheckpointAdapters as a cascadingCache. Each cached key is a
// state() store — subscribable, update-in-place. Tier 0 is hottest.
//
// Usage:
//   const storage = tieredStorage([memoryAdapter(), fileAdapter({ dir: ".cache" })], {
//     maxSize: 100,
//   });
//   const store = storage.load("key"); // WritableStore<unknown | undefined>
//   store.get();                        // current value
//   subscribe(store, v => ...);         // reactive updates
// ---------------------------------------------------------------------------

import type { WritableStore } from "../core/types";
import type { CacheTier, CascadingCache } from "./cascadingCache";
import { cascadingCache } from "./cascadingCache";
import type { CheckpointAdapter } from "./checkpoint";
import type { EvictionPolicy } from "./eviction";

export interface TieredStorageOptions {
	/** Max entries in cache before eviction. 0 = no limit (default). */
	maxSize?: number;
	/** Eviction policy. Default: LRU. Only used when maxSize > 0. */
	eviction?: EvictionPolicy<string>;
}

export interface TieredStorageAdapter {
	/** Get or create a singleton state store for this key. Cascades tiers on miss. */
	load(key: string): WritableStore<unknown | undefined>;
	/** Write value to tier 0 (hottest) and update cache store in-place. */
	save(key: string, value: unknown): void;
	/** Re-cascade tiers into the existing cache store. */
	invalidate(key: string): void;
	/** Remove from all tiers and delete cache entry. */
	delete(key: string): void;
	/** Check if key exists in cache. */
	has(key: string): boolean;
	/** Number of cached entries. */
	readonly size: number;
	/** The underlying cascading cache (for advanced use). */
	readonly cache: CascadingCache<unknown>;
}

/** Convert a CheckpointAdapter to a CacheTier. */
function adapterToTier(adapter: CheckpointAdapter): CacheTier<unknown> {
	return {
		load: (key) => adapter.load(key),
		save: (key, value) => adapter.save(key, value),
		clear: (key) => adapter.clear(key),
	};
}

/**
 * Creates a reactive tiered storage cache backed by `CheckpointAdapter`s.
 *
 * Each cached key is a `state()` store. On cache miss, tiers are tried in order
 * (index 0 = hottest). Hits auto-promote to all faster tiers. Concurrent lookups
 * for the same key share the same state instance (natural dedup).
 *
 * @param adapters - Ordered `CheckpointAdapter`s, hottest first.
 * @param opts - Optional configuration (maxSize, eviction policy).
 *
 * @returns `TieredStorageAdapter` — a reactive cache where each entry is a `WritableStore`.
 *
 * @example
 * ```ts
 * import { tieredStorage, memoryAdapter } from 'callbag-recharge/utils';
 * import { subscribe } from 'callbag-recharge/extra';
 *
 * const storage = tieredStorage([memoryAdapter(), fileAdapter({ dir: ".cache" })], {
 *   maxSize: 100,
 * });
 *
 * const store = storage.load("key");   // WritableStore<unknown | undefined>
 * subscribe(store, v => console.log(v)); // reactive updates on cache changes
 * ```
 *
 * @category utils
 */
export function tieredStorage(
	adapters: CheckpointAdapter[],
	opts?: TieredStorageOptions,
): TieredStorageAdapter {
	const cache = cascadingCache<unknown>(adapters.map(adapterToTier), {
		maxSize: opts?.maxSize,
		eviction: opts?.eviction,
	});

	return {
		load: (key) => cache.load(key),
		save: (key, value) => cache.save(key, value),
		invalidate: (key) => cache.invalidate(key),
		delete: (key) => cache.delete(key),
		has: (key) => cache.has(key),
		get size() {
			return cache.size;
		},
		cache,
	};
}
