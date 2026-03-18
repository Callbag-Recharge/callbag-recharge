// ---------------------------------------------------------------------------
// ReactiveMap — Level 3 reactive key-value data structure
// ---------------------------------------------------------------------------
// Replaces kvStore with a correct single-source-of-truth design.
//
// Architecture:
// - _map: Map<string, V> is the ONLY source of truth for values.
// - _states: Map<string, WritableStore<V|undefined>> are INTERNAL stores
//   that mirror _map values. Never exposed — only used to drive select().
// - select(key) returns a cached read-only derived from the internal state.
// - All mutations go through _map first, then sync to internal state.
//   No divergence possible because there is only one write path.
// - _version: state<number> bumped on key add/delete. keysStore is derived
//   from _version — materializes keys array only when observed.
// - events: state<KVEvent> for keyspace notifications, zero cost if nobody
//   subscribes (callbag lazy start).
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { batch, teardown } from "../core/protocol";
import { state } from "../core/state";
import type { Store, WritableStore } from "../core/types";
import type { EvictionPolicy } from "../utils/eviction";
import { fifo } from "../utils/eviction";
import type { KVEvent, MapSnapshot, ReactiveMap, ReactiveMapOptions } from "./types";

let mapCounter = 0;

/**
 * Restore a reactiveMap from a snapshot. Preserves id; version resets to 0.
 */
reactiveMap.from = function from<V>(
	snap: MapSnapshot<V>,
	opts?: Omit<ReactiveMapOptions<V>, "id">,
): ReactiveMap<V> {
	const m = reactiveMap<V>({ ...opts, id: snap.id });
	for (const [k, v] of snap.entries) m.set(k, v);
	return m;
};

export function reactiveMap<V>(opts?: ReactiveMapOptions<V>): ReactiveMap<V> {
	const counter = ++mapCounter;
	const nodeId = opts?.id ?? `rmap-${counter}`;
	const defaultTTL = opts?.defaultTTL ?? 0;
	const equals = opts?.equals ?? (Object.is as (a: V, b: V) => boolean);
	const maxSize = opts?.maxSize ?? 0; // 0 = unlimited
	const _evictionPolicy: EvictionPolicy<string> | null =
		maxSize > 0 ? (opts?.eviction ?? fifo<string>()) : null;

	// Source of truth
	const _map = new Map<string, V>();

	// Internal reactive stores per key (never exposed directly)
	const _states = new Map<string, WritableStore<V | undefined>>();

	// TTL timers + deadlines
	const _timers = new Map<string, ReturnType<typeof setTimeout>>();
	const _deadlines = new Map<string, number>();

	// Version counter — bumped on key add/delete (not value updates)
	const _version = state<number>(0, { name: `${nodeId}:ver` });

	// Lazy keys materialization — only recomputes when _version changes
	const _keysStore: Store<string[]> = derived([_version], () => Array.from(_map.keys()), {
		name: `${nodeId}:keys`,
	});

	const _sizeStore: Store<number> = derived([_version], () => _map.size, {
		name: `${nodeId}:size`,
	});

	// Keyspace events — zero cost if unsubscribed
	const _events = state<KVEvent<V> | undefined>(undefined, {
		name: `${nodeId}:events`,
		equals: () => false, // Always emit (events are ephemeral)
	});

	// Cached select() derived stores
	const _selects = new Map<string, Store<V | undefined>>();

	let destroyed = false;

	// ---- Internal helpers ----

	// Wrap user equals to handle undefined safely
	const _undefinedSafeEquals = (a: V | undefined, b: V | undefined): boolean => {
		if (a === undefined || b === undefined) return a === b;
		return equals(a, b);
	};

	function _getOrCreateState(key: string): WritableStore<V | undefined> {
		let s = _states.get(key);
		if (!s) {
			s = state<V | undefined>(_map.get(key), {
				name: `${nodeId}:${key}`,
				equals: _undefinedSafeEquals,
			});
			_states.set(key, s);
		}
		return s;
	}

	function _clearTTL(key: string): void {
		const timer = _timers.get(key);
		if (timer !== undefined) {
			clearTimeout(timer);
			_timers.delete(key);
		}
		_deadlines.delete(key);
	}

	function _setTTL(key: string, ttlMs: number): void {
		_clearTTL(key);
		if (ttlMs > 0) {
			_deadlines.set(key, Date.now() + ttlMs);
			_timers.set(
				key,
				setTimeout(() => {
					_timers.delete(key);
					_deadlines.delete(key);
					rmap.delete(key);
				}, ttlMs),
			);
		}
	}

	function _emitEvent(type: KVEvent<V>["type"], key?: string, value?: V): void {
		_events.set({ type, key, value });
	}

	function _evictIfNeeded(): void {
		if (!_evictionPolicy || _map.size <= maxSize) return;
		const toEvict = _evictionPolicy.evict(_map.size - maxSize);
		for (const key of toEvict) {
			if (_map.has(key)) rmap.delete(key);
		}
	}

	// ---- Public API ----

	const rmap: ReactiveMap<V> = {
		get id() {
			return nodeId;
		},
		get version() {
			return _version.get();
		},

		get(key: string): V | undefined {
			_evictionPolicy?.touch(key);
			return _map.get(key);
		},

		set(key: string, value: V): void {
			if (destroyed) return;
			const isNew = !_map.has(key);
			_map.set(key, value);

			// Sync internal state if it exists
			const s = _states.get(key);
			if (s) s.set(value);

			if (isNew) {
				_evictIfNeeded(); // evict before insert — new key can't be victim
				_evictionPolicy?.insert(key);
				_version.update((v) => v + 1);
			} else {
				_evictionPolicy?.touch(key);
			}

			// Apply default TTL for new keys
			if (isNew && defaultTTL > 0) {
				_setTTL(key, defaultTTL);
			}

			_emitEvent("set", key, value);
		},

		delete(key: string): boolean {
			if (!_map.has(key)) return false;
			_map.delete(key);
			_clearTTL(key);
			_evictionPolicy?.delete(key);

			// Set internal state to undefined (don't remove — subscribers may exist)
			const s = _states.get(key);
			if (s) s.set(undefined);

			_version.update((v) => v + 1);
			_emitEvent("delete", key);
			return true;
		},

		has(key: string): boolean {
			return _map.has(key);
		},

		update(key: string, fn: (current: V | undefined) => V): void {
			rmap.set(key, fn(_map.get(key)));
		},

		getOrSet(key: string, factory: () => V): V {
			const existing = _map.get(key);
			if (existing !== undefined) return existing;
			// Also handle the case where the key exists with undefined-ish values
			if (_map.has(key)) return existing as V;
			const value = factory();
			rmap.set(key, value);
			return value;
		},

		// --- Bulk ---

		keys(): string[] {
			return Array.from(_map.keys());
		},

		values(): V[] {
			return Array.from(_map.values());
		},

		entries(): [string, V][] {
			return Array.from(_map.entries());
		},

		size(): number {
			return _map.size;
		},

		clear(): void {
			if (_map.size === 0) return;
			batch(() => {
				for (const timer of _timers.values()) clearTimeout(timer);
				_timers.clear();
				_deadlines.clear();
				_evictionPolicy?.clear();

				for (const s of _states.values()) s.set(undefined);
				_map.clear();
				_version.update((v) => v + 1);
				_emitEvent("clear");
			});
		},

		setMany(entries: Record<string, V> | [string, V][]): void {
			if (destroyed) return;
			const pairs = Array.isArray(entries) ? entries : Object.entries(entries);
			batch(() => {
				for (const [key, value] of pairs) {
					rmap.set(key, value);
				}
			});
		},

		// --- Reactive ---

		select(key: string): Store<V | undefined> {
			let cached = _selects.get(key);
			if (cached) return cached;

			const internal = _getOrCreateState(key);
			cached = derived([internal], () => internal.get(), {
				name: `${nodeId}:${key}:select`,
				equals: _undefinedSafeEquals,
			});
			_selects.set(key, cached);
			return cached;
		},

		keysStore: _keysStore,
		sizeStore: _sizeStore,

		where(pred: (value: V, key: string) => boolean): Store<[string, V][]> {
			// Derive from both _version (structural changes) and _events (value updates).
			// _events fires on every set/delete/clear, so value updates on existing keys
			// also trigger recomputation of the filter.
			return derived(
				[_version, _events],
				() => {
					const result: [string, V][] = [];
					for (const [k, v] of _map) {
						if (pred(v, k)) result.push([k, v]);
					}
					return result;
				},
				{ name: `${nodeId}:where` },
			);
		},

		// --- TTL ---

		setWithTTL(key: string, value: V, ttlMs: number): void {
			rmap.set(key, value);
			_setTTL(key, ttlMs);
		},

		ttl(key: string): number | undefined {
			const deadline = _deadlines.get(key);
			if (deadline === undefined) return undefined;
			const remaining = deadline - Date.now();
			return remaining > 0 ? remaining : 0;
		},

		persist(key: string): void {
			_clearTTL(key);
		},

		// --- Events ---

		events: _events as Store<KVEvent<V> | undefined>,

		// --- Scoping ---

		namespace(prefix: string): ReactiveMap<V> {
			// Thin proxy that prefixes all keys
			const nsId = `${nodeId}:ns:${prefix}`;
			const ns: ReactiveMap<V> = {
				get id() {
					return nsId;
				},
				get version() {
					return _version.get();
				},
				get: (key) => rmap.get(prefix + key),
				set: (key, value) => rmap.set(prefix + key, value),
				delete: (key) => rmap.delete(prefix + key),
				has: (key) => rmap.has(prefix + key),
				update: (key, fn) => rmap.update(prefix + key, fn),
				getOrSet: (key, factory) => rmap.getOrSet(prefix + key, factory),
				keys: () =>
					rmap
						.keys()
						.filter((k) => k.startsWith(prefix))
						.map((k) => k.slice(prefix.length)),
				values: () => {
					const result: V[] = [];
					for (const [k, v] of _map) {
						if (k.startsWith(prefix)) result.push(v);
					}
					return result;
				},
				entries: () => {
					const result: [string, V][] = [];
					for (const [k, v] of _map) {
						if (k.startsWith(prefix)) result.push([k.slice(prefix.length), v]);
					}
					return result;
				},
				size: () => {
					let count = 0;
					for (const k of _map.keys()) {
						if (k.startsWith(prefix)) count++;
					}
					return count;
				},
				clear: () => {
					batch(() => {
						for (const k of rmap.keys()) {
							if (k.startsWith(prefix)) rmap.delete(k);
						}
					});
				},
				setMany: (entries) => {
					const pairs = Array.isArray(entries) ? entries : Object.entries(entries);
					batch(() => {
						for (const [key, value] of pairs) {
							rmap.set(prefix + key, value);
						}
					});
				},
				select: (key) => rmap.select(prefix + key),
				keysStore: derived([_keysStore], () =>
					_keysStore
						.get()
						.filter((k) => k.startsWith(prefix))
						.map((k) => k.slice(prefix.length)),
				),
				sizeStore: derived([_keysStore], () => {
					let count = 0;
					for (const k of _keysStore.get()) {
						if (k.startsWith(prefix)) count++;
					}
					return count;
				}),
				where: (pred) =>
					derived([_version, _events], () => {
						const result: [string, V][] = [];
						for (const [k, v] of _map) {
							if (k.startsWith(prefix) && pred(v, k.slice(prefix.length))) {
								result.push([k.slice(prefix.length), v]);
							}
						}
						return result;
					}),
				setWithTTL: (key, value, ttlMs) => rmap.setWithTTL(prefix + key, value, ttlMs),
				ttl: (key) => rmap.ttl(prefix + key),
				persist: (key) => rmap.persist(prefix + key),
				events: rmap.events, // Shares parent events (includes prefixed keys)
				namespace: (subPrefix) => rmap.namespace(prefix + subPrefix),
				snapshot: () => ({
					type: "reactiveMap" as const,
					id: nsId,
					version: _version.get(),
					entries: ns.entries(),
				}),
				destroy: () => ns.clear(), // Namespace destroy only clears its keys
			};
			return ns;
		},

		// --- Serialization ---

		snapshot(): MapSnapshot<V> {
			return {
				type: "reactiveMap",
				id: nodeId,
				version: _version.get(),
				entries: Array.from(_map.entries()),
			};
		},

		// --- Lifecycle ---

		destroy(): void {
			if (destroyed) return;
			destroyed = true;

			for (const timer of _timers.values()) clearTimeout(timer);
			_timers.clear();
			_deadlines.clear();
			_evictionPolicy?.clear();

			for (const s of _states.values()) teardown(s);
			_states.clear();

			for (const s of _selects.values()) teardown(s);
			_selects.clear();

			teardown(_version);
			teardown(_events);
			_map.clear();
		},
	};

	return rmap;
}
