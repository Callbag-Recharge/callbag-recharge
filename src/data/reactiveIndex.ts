// ---------------------------------------------------------------------------
// ReactiveIndex — Level 3 reactive secondary index
// ---------------------------------------------------------------------------
// Maintains a reverse mapping: indexKey → Set<primaryKey>.
// Designed to be driven by a source data structure (reactiveMap, collection)
// that calls add/remove/update when entries change.
//
// Architecture:
// - _index: Map<string, Set<string>> — source of truth
// - _reverse: Map<string, Set<string>> — primaryKey → indexKeys (for fast update/remove)
// - _states: Map<string, WritableStore<Set<string>>> — per-indexKey reactive stores
// - _version: state<number> — bumped on structural changes (key add/remove)
//
// Usage:
//   const tagIndex = reactiveIndex<User>({ keyFn: (u) => u.tags });
//   tagIndex.add("u1", ["admin", "active"]);
//   tagIndex.get("admin");           // Set{"u1"}
//   tagIndex.select("admin").get();  // reactive Set{"u1"}
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { batch, teardown } from "../core/protocol";
import { state } from "../core/state";
import type { Store, WritableStore } from "../core/types";
import type { IndexSnapshot, ReactiveIndex } from "./types";

let indexCounter = 0;

export interface ReactiveIndexCreateOptions {
	/** User-specified ID. Auto-generated if omitted. */
	id?: string;
}

/**
 * Restore a reactiveIndex from a snapshot. Preserves id; version resets to 0.
 */
reactiveIndex.from = function from(snap: IndexSnapshot): ReactiveIndex {
	const idx = reactiveIndex({ id: snap.id });
	for (const [indexKey, primaryKeys] of Object.entries(snap.index)) {
		for (const pk of primaryKeys) idx.add(pk, [indexKey]);
	}
	return idx;
};

export function reactiveIndex(opts?: ReactiveIndexCreateOptions): ReactiveIndex {
	const counter = ++indexCounter;
	const nodeId = opts?.id ?? `ridx-${counter}`;

	// indexKey → Set<primaryKey>
	const _index = new Map<string, Set<string>>();

	// primaryKey → Set<indexKey> (reverse map for fast update/remove)
	const _reverse = new Map<string, Set<string>>();

	// Internal reactive stores per index key
	const _states = new Map<string, WritableStore<Set<string>>>();

	// Cached select() derived stores
	const _selects = new Map<string, Store<Set<string>>>();

	// Version counter — bumped on index key add/remove
	const _version = state<number>(0, { name: `${nodeId}:ver` });

	const _keysStore: Store<string[]> = derived([_version], () => Array.from(_index.keys()), {
		name: `${nodeId}:keys`,
	});

	const _sizeStore: Store<number> = derived([_version], () => _index.size, {
		name: `${nodeId}:size`,
	});

	let destroyed = false;

	const _emptySet: Set<string> = Object.freeze(new Set<string>()) as Set<string>;

	// ---- Internal helpers ----

	function _getOrCreateState(indexKey: string): WritableStore<Set<string>> {
		let s = _states.get(indexKey);
		if (!s) {
			s = state<Set<string>>(_index.get(indexKey) ?? new Set(), {
				name: `${nodeId}:${indexKey}`,
				equals: () => false, // Sets are mutable — always emit on update
			});
			_states.set(indexKey, s);
		}
		return s;
	}

	function _syncState(indexKey: string): void {
		const s = _states.get(indexKey);
		if (s) {
			const current = _index.get(indexKey);
			s.set(current ? new Set(current) : new Set());
		}
	}

	function _addToIndex(primaryKey: string, indexKey: string): boolean {
		let set = _index.get(indexKey);
		const isNewKey = !set;
		if (!set) {
			set = new Set();
			_index.set(indexKey, set);
		}
		set.add(primaryKey);
		return isNewKey;
	}

	function _removeFromIndex(primaryKey: string, indexKey: string): boolean {
		const set = _index.get(indexKey);
		if (!set) return false;
		set.delete(primaryKey);
		if (set.size === 0) {
			_index.delete(indexKey);
			return true; // key removed
		}
		return false;
	}

	// ---- Public API ----

	const idx: ReactiveIndex = {
		get id() {
			return nodeId;
		},
		get version() {
			return _version.get();
		},

		get(indexKey: string): Set<string> {
			const set = _index.get(indexKey);
			return set ? (Object.freeze(new Set(set)) as Set<string>) : _emptySet;
		},

		has(indexKey: string): boolean {
			const set = _index.get(indexKey);
			return set !== undefined && set.size > 0;
		},

		keys(): string[] {
			return Array.from(_index.keys());
		},

		get size() {
			return _index.size;
		},

		// --- Reactive ---

		select(indexKey: string): Store<Set<string>> {
			let cached = _selects.get(indexKey);
			if (cached) return cached;

			const internal = _getOrCreateState(indexKey);
			cached = derived([internal], () => internal.get(), {
				name: `${nodeId}:${indexKey}:select`,
			});
			_selects.set(indexKey, cached);
			return cached;
		},

		keysStore: _keysStore,
		sizeStore: _sizeStore,

		// --- Mutation ---

		add(primaryKey: string, indexKeys: string[]): void {
			if (destroyed || indexKeys.length === 0) return;

			// Track reverse mapping
			let reverseSet = _reverse.get(primaryKey);
			if (!reverseSet) {
				reverseSet = new Set();
				_reverse.set(primaryKey, reverseSet);
			}

			batch(() => {
				let structuralChange = false;
				for (const indexKey of indexKeys) {
					reverseSet!.add(indexKey);
					if (_addToIndex(primaryKey, indexKey)) structuralChange = true;
					_syncState(indexKey);
				}
				if (structuralChange) _version.update((v) => v + 1);
			});
		},

		remove(primaryKey: string): void {
			if (destroyed) return;
			const reverseSet = _reverse.get(primaryKey);
			if (!reverseSet) return;

			batch(() => {
				let structuralChange = false;
				for (const indexKey of reverseSet!) {
					if (_removeFromIndex(primaryKey, indexKey)) structuralChange = true;
					_syncState(indexKey);
				}
				_reverse.delete(primaryKey);
				if (structuralChange) _version.update((v) => v + 1);
			});
		},

		update(primaryKey: string, indexKeys: string[]): void {
			if (destroyed) return;
			const oldKeys = _reverse.get(primaryKey);
			const newKeySet = new Set(indexKeys);

			batch(() => {
				let structuralChange = false;

				// Remove from old keys not in new set
				if (oldKeys) {
					for (const oldKey of oldKeys) {
						if (!newKeySet.has(oldKey)) {
							if (_removeFromIndex(primaryKey, oldKey)) structuralChange = true;
							_syncState(oldKey);
						}
					}
				}

				// Add to new keys
				let reverseSet = _reverse.get(primaryKey);
				if (!reverseSet) {
					reverseSet = new Set();
					_reverse.set(primaryKey, reverseSet);
				}
				reverseSet.clear();

				for (const indexKey of indexKeys) {
					reverseSet.add(indexKey);
					if (_addToIndex(primaryKey, indexKey)) structuralChange = true;
					_syncState(indexKey);
				}

				if (structuralChange) _version.update((v) => v + 1);
			});
		},

		clear(): void {
			if (_index.size === 0) return;
			batch(() => {
				_index.clear();
				_reverse.clear();
				// Reset all tracked states to empty
				for (const s of _states.values()) s.set(new Set());
				_version.update((v) => v + 1);
			});
		},

		// --- Serialization ---

		snapshot(): IndexSnapshot {
			const index: Record<string, string[]> = {};
			for (const [key, set] of _index) {
				index[key] = Array.from(set);
			}
			return {
				type: "reactiveIndex",
				id: nodeId,
				version: _version.get(),
				index,
			};
		},

		// --- Lifecycle ---

		destroy(): void {
			if (destroyed) return;
			destroyed = true;
			_index.clear();
			_reverse.clear();

			for (const s of _states.values()) teardown(s);
			_states.clear();

			for (const s of _selects.values()) teardown(s);
			_selects.clear();

			teardown(_version);
		},
	};

	return idx;
}
