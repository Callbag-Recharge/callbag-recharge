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

export interface ReactiveMap<V> extends NodeV0 {
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

	// --- Serialization ---

	/** Return a JSON-serializable snapshot of the map. */
	snapshot(): MapSnapshot<V>;

	// --- Lifecycle ---

	/** Tear down all stores and timers. */
	destroy(): void;
}

export interface ReactiveMapOptions<V> {
	/** User-specified ID. Auto-generated if omitted. */
	id?: string;
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

export type LogEventType = "append" | "trim" | "clear";

export interface LogEvent<V> {
	type: LogEventType;
	seq?: number;
	value?: V;
}

export interface ReactiveLog<V> extends NodeV0 {
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

	// --- Serialization ---

	/** Return a JSON-serializable snapshot of the log. */
	snapshot(): LogSnapshot<V>;

	// --- Lifecycle ---

	/** Remove up to `count` entries from the head (oldest first). Returns the number actually removed. */
	trimHead(count: number): number;
	/** Remove all entries. */
	clear(): void;
	/** Tear down all stores. */
	destroy(): void;
}

export interface ReactiveLogOptions {
	/** User-specified ID. Auto-generated if omitted. */
	id?: string;
	/** Maximum number of entries. 0 = unlimited (default). Oldest trimmed on overflow. */
	maxSize?: number;
}

// ---------------------------------------------------------------------------
// ReactiveIndex
// ---------------------------------------------------------------------------

/** An index entry mapping an index key to a set of primary keys. */
export interface ReactiveIndex extends NodeV0 {
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

	// --- Serialization ---

	/** Return a JSON-serializable snapshot of the index. */
	snapshot(): IndexSnapshot;

	// --- Lifecycle ---

	/** Tear down all stores. */
	destroy(): void;
}

export interface ReactiveIndexOptions<V> {
	/** Function that extracts index keys from a value. */
	keyFn: (value: V, primaryKey: string) => string[];
}

// ---------------------------------------------------------------------------
// NodeV0 — id + version + snapshot (Level 3 serialization)
// ---------------------------------------------------------------------------

export interface NodeV0 {
	/** User-specified or auto-generated unique identifier. */
	readonly id: string;
	/** Monotonically increasing version number (bumped on structural changes). */
	readonly version: number;
}

export interface MapSnapshot<V> extends NodeV0 {
	type: "reactiveMap";
	entries: [string, V][];
}

export interface LogSnapshot<V> extends NodeV0 {
	type: "reactiveLog";
	entries: Array<{ seq: number; value: V }>;
	headSeq: number;
	tailSeq: number;
}

export interface IndexSnapshot extends NodeV0 {
	type: "reactiveIndex";
	index: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// PubSub
// ---------------------------------------------------------------------------

export interface PubSub<T = unknown> extends NodeV0 {
	/** Publish a message to a topic. */
	publish(topic: string, message: T): void;
	/** Subscribe to a topic. Returns a read-only reactive store of the latest message. */
	subscribe(topic: string): Store<T | undefined>;
	/** Get all topics that have been created. */
	topics(): string[];
	/** Return a JSON-serializable snapshot. */
	snapshot(): PubSubSnapshot<T>;
	/** Tear down all channel stores. */
	destroy(): void;
}

export interface PubSubSnapshot<T> extends NodeV0 {
	type: "pubsub";
	channels: Record<string, T | undefined>;
}

// ---------------------------------------------------------------------------
// ReactiveList
// ---------------------------------------------------------------------------

export interface ListSnapshot<T> extends NodeV0 {
	type: "reactiveList";
	items: T[];
}
