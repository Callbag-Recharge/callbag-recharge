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

// ---------------------------------------------------------------------------
// ReactiveLog
// ---------------------------------------------------------------------------

export interface LogEntry<V> {
	/** Monotonically increasing sequence number (1-based). */
	seq: number;
	value: V;
}

export type LogEventType = "append" | "clear";

export interface LogEvent<V> {
	type: LogEventType;
	seq?: number;
	value?: V;
}

export interface ReactiveLog<V> {
	// --- Write ---

	/** Append a value. Returns the assigned sequence number. */
	append(value: V): number;
	/** Batch append. Returns sequence numbers. */
	appendMany(values: V[]): number[];

	// --- Read ---

	/** Point read by sequence number — O(1). */
	get(seq: number): LogEntry<V> | undefined;
	/** Range read by sequence number (inclusive). */
	slice(from?: number, to?: number): LogEntry<V>[];
	/** Snapshot of all entries. */
	toArray(): LogEntry<V>[];
	/** Current number of entries. */
	readonly length: number;
	/** Sequence number of the oldest entry still in the log. 0 if empty. */
	readonly headSeq: number;
	/** Sequence number of the newest entry. 0 if empty. */
	readonly tailSeq: number;

	// --- Reactive ---

	/** Reactive count of entries. */
	lengthStore: Store<number>;
	/** Reactive store of the most recent entry. */
	latest: Store<LogEntry<V> | undefined>;
	/** Reactive store of the last N entries (default: all). */
	tail(n?: number): Store<LogEntry<V>[]>;
	/** Event notification store. Zero cost if unsubscribed. */
	events: Store<LogEvent<V> | undefined>;

	// --- Lifecycle ---

	/** Remove all entries. */
	clear(): void;
	/** Tear down all stores. */
	destroy(): void;
}

export interface ReactiveLogOptions {
	/** Maximum number of entries. 0 = unlimited (default). Oldest trimmed on overflow. */
	maxSize?: number;
}

// ---------------------------------------------------------------------------
// ReactiveIndex
// ---------------------------------------------------------------------------

/** An index entry mapping an index key to a set of primary keys. */
export interface ReactiveIndex {
	// --- Read ---

	/** Get all primary keys matching an index key. */
	get(indexKey: string): Set<string>;
	/** Check if an index key has any entries. */
	has(indexKey: string): boolean;
	/** Get all index keys. */
	keys(): string[];
	/** Current number of distinct index keys. */
	readonly size: number;

	// --- Reactive ---

	/** Reactive store of primary keys for a given index key. Cached per key. */
	select(indexKey: string): Store<Set<string>>;
	/** Reactive store of all index keys. */
	keysStore: Store<string[]>;
	/** Reactive store of the number of distinct index keys. */
	sizeStore: Store<number>;

	// --- Mutation (typically driven by the source) ---

	/** Add a primary key under one or more index keys. */
	add(primaryKey: string, indexKeys: string[]): void;
	/** Remove a primary key from all index keys. */
	remove(primaryKey: string): void;
	/** Update a primary key's index keys (remove old, add new). */
	update(primaryKey: string, indexKeys: string[]): void;
	/** Clear all entries. */
	clear(): void;

	// --- Lifecycle ---

	/** Tear down all stores. */
	destroy(): void;
}

export interface ReactiveIndexOptions<V> {
	/** Function that extracts index keys from a value. */
	keyFn: (value: V, primaryKey: string) => string[];
}
