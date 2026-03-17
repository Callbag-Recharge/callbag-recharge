// ---------------------------------------------------------------------------
// Data module types — Level 3 reactive data structures
// ---------------------------------------------------------------------------

import type { Store } from "../core/types";
import type { EvictionPolicy } from "../utils/eviction";

// ---------------------------------------------------------------------------
// ReactiveMap
// ---------------------------------------------------------------------------

export type KVEventType = "set" | "delete" | "clear";

export interface KVEvent<V> {
	type: KVEventType;
	key?: string;
	value?: V;
}

export interface ReactiveMap<V> {
	// --- CRUD ---

	/** Point read — O(1), ~10ns */
	get(key: string): V | undefined;
	/** Point write — O(1), ~50ns */
	set(key: string, value: V): void;
	/** Delete a key. Returns true if the key existed. */
	delete(key: string): boolean;
	/** Check if a key exists. */
	has(key: string): boolean;
	/** Atomic read-modify-write. */
	update(key: string, fn: (current: V | undefined) => V): void;
	/** Get existing value or create with factory. */
	getOrSet(key: string, factory: () => V): V;

	// --- Bulk ---

	/** Get all keys (snapshot). */
	keys(): string[];
	/** Get all values (snapshot). */
	values(): V[];
	/** Get all entries (snapshot). */
	entries(): [string, V][];
	/** Current number of keys. */
	size(): number;
	/** Clear all keys. */
	clear(): void;
	/** Set multiple keys atomically (single DIRTY cycle). */
	setMany(entries: Record<string, V> | [string, V][]): void;

	// --- Reactive (read-only views) ---

	/** Cached read-only reactive view of a key. Auto-cleaned on delete. */
	select(key: string): Store<V | undefined>;
	/** Reactive store of all current keys. Version-gated, lazy materialization. */
	keysStore: Store<string[]>;
	/** Reactive store of current size. */
	sizeStore: Store<number>;
	/** Reactive filtered view. */
	where(pred: (value: V, key: string) => boolean): Store<[string, V][]>;

	// --- TTL ---

	/** Set a key with a time-to-live in milliseconds. */
	setWithTTL(key: string, value: V, ttlMs: number): void;
	/** Get remaining TTL in ms. undefined if no TTL. */
	ttl(key: string): number | undefined;
	/** Remove TTL from a key, keeping the key alive. */
	persist(key: string): void;

	// --- Events ---

	/** Keyspace notification store. Zero cost if unsubscribed. */
	events: Store<KVEvent<V> | undefined>;

	// --- Scoping ---

	/** Virtual partitioning via key prefix. */
	namespace(prefix: string): ReactiveMap<V>;

	// --- Lifecycle ---

	/** Tear down all stores and timers. */
	destroy(): void;
}

export interface ReactiveMapOptions<V> {
	/** Default TTL in milliseconds for all keys. 0 = no expiry (default). */
	defaultTTL?: number;
	/** Custom equality function for value deduplication. Default: Object.is */
	equals?: (a: V, b: V) => boolean;
	/** Maximum number of keys. When exceeded, oldest keys are evicted (FIFO). */
	maxSize?: number;
	/** Eviction policy. Default: fifo(). Only used when maxSize > 0. */
	eviction?: EvictionPolicy<string>;
}
