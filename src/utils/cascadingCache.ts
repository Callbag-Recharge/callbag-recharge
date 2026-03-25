// ---------------------------------------------------------------------------
// cascadingCache — singleton reactive cache with N-tier cascading lookup
// ---------------------------------------------------------------------------
// Each cache entry is a state() store. On miss, tiers are tried in order
// (tier 0 = hottest). Hits auto-promote to all faster tiers. Concurrent
// async lookups for the same key are naturally deduped by the singleton map.
//
// Usage:
//   const cache = cascadingCache([
//     { load: k => memory.get(k), save: (k, v) => memory.set(k, v) },
//     { load: k => fs.readFile(k), save: (k, v) => fs.writeFile(k, v) },
//   ]);
//   const store = cache.load("key"); // Store<V | undefined>
//   subscribe(store, v => console.log(v));
// ---------------------------------------------------------------------------

import { teardown } from "../core/protocol";
import { state } from "../core/state";
import type { WritableStore } from "../core/types";
import { type CallbagSource, rawSubscribe } from "../raw/subscribe";
import type { EvictionPolicy } from "./eviction";
import { lru } from "./eviction";

/** A single lookup/storage tier. */
export interface CacheTier<V> {
	/** Read a value. May return sync or a callbag source. undefined = miss. */
	load(key: string): V | undefined | CallbagSource;
	/** Write a value. Optional — tiers without save are read-only. */
	save?(key: string, value: V): void | CallbagSource;
	/** Delete a value. Optional — tiers without clear are not cleaned on delete. */
	clear?(key: string): void | CallbagSource;
}

export interface CascadingCacheOptions {
	/** Max entries in cache before eviction. 0 = unlimited (default). */
	maxSize?: number;
	/** Eviction policy. Default: LRU. Only used when maxSize > 0. */
	eviction?: EvictionPolicy<string>;
	/**
	 * Write-through on save: if true, save() writes to all tiers (not just tier 0).
	 * Default: false (write to tier 0 only, like CPU L1 cache semantics).
	 */
	writeThrough?: boolean;
}

export interface CascadingCache<V> {
	/** Get or create a singleton state store for this key. Cascades tiers on miss. */
	load(key: string): WritableStore<V | undefined>;
	/** Write value to tier(s) and update cache store in-place. */
	save(key: string, value: V): void;
	/** Re-cascade tiers into the existing cache store (subscribers see the update). */
	invalidate(key: string): void;
	/** Remove from all tiers, complete the store (sends END to subscribers), and delete cache entry. */
	delete(key: string): void;
	/** Check if key exists in cache map. */
	has(key: string): boolean;
	/** Number of cached entries. */
	readonly size: number;
}

/** Safely subscribe to a potentially callbag result (fire-and-forget). */
function fireAndForget(result: void | CallbagSource): void {
	if (typeof result === "function") {
		rawSubscribe(result, () => {});
	}
}

/**
 * Creates a singleton reactive cache with N-tier cascading lookup.
 *
 * Each cached entry is a `state()` store. On cache miss, tiers are tried in order
 * (index 0 = hottest/fastest). When a lower tier hits, the value is auto-promoted
 * to all faster tiers. Concurrent lookups for the same key share the same state
 * instance — natural dedup without `keyedAsync`.
 *
 * **Note:** `undefined` is used as the "not yet loaded" sentinel. Tiers that
 * return `undefined` are treated as cache misses. Do not store `undefined` as
 * a meaningful value.
 *
 * @param tiers - Ordered lookup tiers, hottest first.
 * @param opts - Optional configuration (maxSize, eviction policy, writeThrough).
 *
 * @returns `CascadingCache<V>` — a reactive cache where each entry is a `WritableStore<V | undefined>`.
 *
 * @example
 * ```ts
 * import { cascadingCache } from 'callbag-recharge/utils';
 * import { subscribe } from 'callbag-recharge/extra';
 *
 * const cache = cascadingCache([
 *   { load: k => memoryMap.get(k), save: (k, v) => memoryMap.set(k, v) },
 *   { load: k => fetch(`/api/${k}`).then(r => r.json()) },
 * ]);
 *
 * const user = cache.load("user:42"); // WritableStore<User | undefined>
 * subscribe(user, v => console.log("user:", v));
 * user.get(); // value or undefined (if async tier pending)
 * ```
 *
 * @category utils
 */
export function cascadingCache<V>(
	tiers: CacheTier<V>[],
	opts?: CascadingCacheOptions,
): CascadingCache<V> {
	const entries = new Map<string, WritableStore<V | undefined>>();
	const maxSize = opts?.maxSize ?? 0;
	const policy = maxSize > 0 ? (opts?.eviction ?? lru<string>()) : null;
	const writeThrough = opts?.writeThrough ?? false;

	/**
	 * Monotonic generation counter per key. Incremented on save() and
	 * invalidate(). Async cascade callbacks compare their captured generation
	 * against the current one — stale results are discarded.
	 */
	const generations = new Map<string, number>();

	function getGen(key: string): number {
		return generations.get(key) ?? 0;
	}

	function bumpGen(key: string): number {
		const next = getGen(key) + 1;
		generations.set(key, next);
		return next;
	}

	/**
	 * Promote a value to all tiers above the hit tier (fire-and-forget).
	 */
	function promote(key: string, value: V, hitTierIndex: number): void {
		for (let i = 0; i < hitTierIndex; i++) {
			const tier = tiers[i];
			if (tier.save) {
				fireAndForget(tier.save(key, value));
			}
		}
	}

	/**
	 * Evict entries when cache exceeds maxSize.
	 * Demotes evicted values to the lowest tier that supports save.
	 * Sends END (teardown) to evicted stores so subscribers know the entry is gone.
	 */
	function evictIfNeeded(): void {
		if (!policy || maxSize <= 0) return;
		while (policy.size() > maxSize) {
			const victims = policy.evict(1);
			if (victims.length === 0) break;
			for (const key of victims) {
				const store = entries.get(key);
				if (store) {
					const value = store.get();
					if (value !== undefined) {
						// Demote to the deepest tier that supports save
						let demoteTier = -1;
						for (let i = tiers.length - 1; i >= 0; i--) {
							if (tiers[i].save) {
								fireAndForget(tiers[i].save!(key, value));
								demoteTier = i;
								break;
							}
						}
						// Clear tiers above the demote target so re-load doesn't hit stale data
						for (let i = 0; i < demoteTier; i++) {
							if (tiers[i].clear) {
								fireAndForget(tiers[i].clear!(key));
							}
						}
					}
					// Complete the store so subscribers receive END
					teardown(store);
				}
				entries.delete(key);
				generations.delete(key);
			}
		}
	}

	/**
	 * Cascade through tiers for a key, setting the store when a value is found.
	 * Returns the generation at cascade start for staleness detection.
	 */
	function cascade(key: string, store: WritableStore<V | undefined>): void {
		const gen = bumpGen(key);
		cascadeFrom(key, store, 0, gen);
	}

	function cascadeFrom(
		key: string,
		store: WritableStore<V | undefined>,
		tierIndex: number,
		gen: number,
	): void {
		if (tierIndex >= tiers.length) {
			return;
		}

		let result: V | undefined | CallbagSource;
		try {
			result = tiers[tierIndex].load(key);
		} catch {
			// Sync tier threw — skip to next tier
			cascadeFrom(key, store, tierIndex + 1, gen);
			return;
		}

		if (typeof result === "function") {
			// CallbagSource — subscribe to get the value
			let resolved = false;
			rawSubscribe(
				result as CallbagSource,
				(value: unknown) => {
					// Stale check: if generation advanced, discard this result
					if (resolved || getGen(key) !== gen) return;
					resolved = true;
					if (value !== undefined) {
						store.set(value as V);
						promote(key, value as V, tierIndex);
					} else {
						cascadeFrom(key, store, tierIndex + 1, gen);
					}
				},
				{
					onEnd: (err) => {
						// Error or clean END with no data = miss; cascade to next tier
						if (resolved || getGen(key) !== gen) return;
						resolved = true;
						cascadeFrom(key, store, tierIndex + 1, gen);
					},
				},
			);
		} else if (result !== undefined) {
			// Sync hit — no staleness possible (synchronous)
			store.set(result);
			promote(key, result, tierIndex);
		} else {
			// Sync miss — try next tier
			cascadeFrom(key, store, tierIndex + 1, gen);
		}
	}

	return {
		load(key: string): WritableStore<V | undefined> {
			const existing = entries.get(key);
			if (existing) {
				policy?.touch(key);
				return existing;
			}

			const store = state<V | undefined>(undefined);
			entries.set(key, store);
			if (policy) {
				policy.insert(key);
				evictIfNeeded();
			}

			cascade(key, store);
			return store;
		},

		save(key: string, value: V): void {
			// Bump generation to invalidate any in-flight cascade
			bumpGen(key);

			// Write to tiers
			if (writeThrough) {
				for (const tier of tiers) {
					if (tier.save) {
						fireAndForget(tier.save(key, value));
					}
				}
			} else if (tiers[0]?.save) {
				fireAndForget(tiers[0].save(key, value));
			}

			// Update or create cache entry in-place
			const existing = entries.get(key);
			if (existing) {
				existing.set(value);
				policy?.touch(key);
			} else {
				const store = state<V | undefined>(value);
				entries.set(key, store);
				if (policy) {
					policy.insert(key);
					evictIfNeeded();
				}
			}
		},

		invalidate(key: string): void {
			const existing = entries.get(key);
			if (existing) {
				// Re-cascade into the same state instance.
				// cascade() bumps generation, so any in-flight async is discarded.
				cascade(key, existing);
			}
		},

		delete(key: string): void {
			policy?.delete(key);
			const store = entries.get(key);
			if (store) {
				// Complete the store so subscribers receive END
				teardown(store);
			}
			entries.delete(key);
			generations.delete(key);
			for (const tier of tiers) {
				if (tier.clear) {
					fireAndForget(tier.clear(key));
				}
			}
		},

		has(key: string): boolean {
			return entries.has(key);
		},

		get size(): number {
			return entries.size;
		},
	};
}
