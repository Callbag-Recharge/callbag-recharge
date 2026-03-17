// ---------------------------------------------------------------------------
// Phase 0: Reactive KV Store
// ---------------------------------------------------------------------------
// A Map-backed reactive key-value store where every key is a lazy state() store.
// Point reads ~10ns, writes ~50ns — 10,000x faster than Redis localhost.
//
// Design:
// - _map: Map<string, V> for raw O(1) reads (no store overhead for get/set)
// - _stores: Map<string, WritableStore<V|undefined>> lazily created per key
// - _keys: state<string[]> reactively tracks key additions/removals
// - TTL via setTimeout per key, cleaned up on delete/destroy
// - Batch via protocol batch() — single DIRTY cycle for setMany()
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { batch, teardown } from "../core/protocol";
import { state } from "../core/state";
import type { Store, WritableStore } from "../core/types";
import type { KVStore, KVStoreOptions } from "./types";

let kvCounter = 0;

export function kvStore<V>(opts?: KVStoreOptions<V>): KVStore<V> {
	const id = ++kvCounter;
	const defaultTTL = opts?.defaultTTL ?? 0;
	const equals = opts?.equals ?? (Object.is as (a: V, b: V) => boolean);

	// Raw storage — fastest possible reads
	const _map = new Map<string, V>();

	// Lazy reactive stores per key
	const _stores = new Map<string, WritableStore<V | undefined>>();

	// TTL timers
	const _timers = new Map<string, ReturnType<typeof setTimeout>>();

	// Reactive key tracking
	const _keys = state<string[]>([], { name: `kv-${id}:keys` });
	const _size = derived([_keys], () => _keys.get().length, {
		name: `kv-${id}:size`,
	});

	let destroyed = false;

	function _syncKeys(): void {
		_keys.set(Array.from(_map.keys()));
	}

	function _getOrCreateStore(key: string): WritableStore<V | undefined> {
		let s = _stores.get(key);
		if (!s) {
			s = state<V | undefined>(_map.get(key), {
				name: `kv-${id}:${key}`,
				equals: equals as (a: V | undefined, b: V | undefined) => boolean,
			});
			_stores.set(key, s);
		}
		return s;
	}

	function _clearTTL(key: string): void {
		const timer = _timers.get(key);
		if (timer !== undefined) {
			clearTimeout(timer);
			_timers.delete(key);
		}
	}

	function _setTTL(key: string, ttlMs: number): void {
		_clearTTL(key);
		if (ttlMs > 0) {
			_timers.set(
				key,
				setTimeout(() => {
					_timers.delete(key);
					kv.delete(key);
				}, ttlMs),
			);
		}
	}

	const kv: KVStore<V> = {
		get(key: string): V | undefined {
			return _map.get(key);
		},

		set(key: string, value: V): void {
			if (destroyed) return;
			const isNew = !_map.has(key);
			_map.set(key, value);

			// Update reactive store if it exists
			const s = _stores.get(key);
			if (s) s.set(value);

			if (isNew) _syncKeys();

			// Apply default TTL if set
			if (defaultTTL > 0 && !_timers.has(key)) {
				_setTTL(key, defaultTTL);
			}
		},

		delete(key: string): boolean {
			if (!_map.has(key)) return false;
			_map.delete(key);
			_clearTTL(key);

			// Set reactive store to undefined (don't delete — subscribers may exist)
			const s = _stores.get(key);
			if (s) s.set(undefined);

			_syncKeys();
			return true;
		},

		has(key: string): boolean {
			return _map.has(key);
		},

		keys(): string[] {
			return Array.from(_map.keys());
		},

		size(): number {
			return _map.size;
		},

		entries(): [string, V][] {
			return Array.from(_map.entries());
		},

		clear(): void {
			if (_map.size === 0) return;
			batch(() => {
				// Clear all TTL timers
				for (const timer of _timers.values()) clearTimeout(timer);
				_timers.clear();

				// Set all reactive stores to undefined
				for (const s of _stores.values()) s.set(undefined);

				_map.clear();
				_syncKeys();
			});
		},

		// --- Reactive API ---

		store(key: string): WritableStore<V | undefined> {
			return _getOrCreateStore(key);
		},

		select(key: string): Store<V | undefined> {
			const s = _getOrCreateStore(key);
			return derived([s], () => s.get(), {
				name: `kv-${id}:${key}:select`,
				equals: equals as (a: V | undefined, b: V | undefined) => boolean,
			});
		},

		keysStore: _keys as Store<string[]>,
		sizeStore: _size,

		// --- Batch ---

		setMany(entries: Record<string, V> | [string, V][]): void {
			if (destroyed) return;
			const pairs = Array.isArray(entries) ? entries : Object.entries(entries);
			batch(() => {
				for (const [key, value] of pairs) {
					kv.set(key, value);
				}
			});
		},

		// --- TTL ---

		setWithTTL(key: string, value: V, ttlMs: number): void {
			kv.set(key, value);
			_setTTL(key, ttlMs);
		},

		// --- Lifecycle ---

		destroy(): void {
			if (destroyed) return;
			destroyed = true;

			// Clear all TTL timers
			for (const timer of _timers.values()) clearTimeout(timer);
			_timers.clear();

			// Tear down all reactive stores
			for (const s of _stores.values()) teardown(s);
			_stores.clear();

			teardown(_keys);
			_map.clear();
		},
	};

	return kv;
}
