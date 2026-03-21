// ---------------------------------------------------------------------------
// ReactiveList — Level 3 reactive ordered collection
// ---------------------------------------------------------------------------
// Reactive ordered collection with positional operations. Unlike reactiveMap
// (key-value), this is index-based with structural change tracking.
//
// Architecture:
// - _items: T[] is the ONLY source of truth.
// - _version: state<number> bumped on every structural change.
// - Derived stores (length, items, at(), slice(), find()) are lazy and
//   version-gated — only recompute when _version changes.
//
// Built on: state, derived, batch
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { state } from "../core/state";
import type { Store } from "../core/types";
import type { ListSnapshot, NodeV0 } from "./types";

export interface ReactiveListOptions {
	/** User-specified ID. Auto-generated if omitted. */
	id?: string;
	/** Debug name prefix. */
	name?: string;
}

export interface ReactiveListResult<T> extends NodeV0 {
	/** Reactive store of all items (read-only snapshot). */
	items: Store<readonly T[]>;
	/** Reactive store of the list length. */
	length: Store<number>;
	/** Reactive version store (bumped on every mutation). Subscribe for reactive updates. */
	versionStore: Store<number>;

	/** Get item at index. */
	get(index: number): T | undefined;
	/** Set item at index. No-op if index is out of bounds. */
	set(index: number, value: T): void;
	/** Append items to the end. */
	push(...items: T[]): void;
	/** Remove and return the last item. */
	pop(): T | undefined;
	/** Insert items at index. No-op if index is negative. */
	insert(index: number, ...items: T[]): void;
	/** Remove count items at index. Returns removed items. */
	remove(index: number, count?: number): T[];
	/** Move item from one index to another. */
	move(from: number, to: number): void;
	/** Swap items at two indices. */
	swap(i: number, j: number): void;
	/** Clear all items. */
	clear(): void;

	/** Reactive store for a specific index (updates on structural changes). Cached per index. */
	at(index: number): Store<T | undefined>;
	/** Reactive store from a slice. Cached per (start, end) pair. */
	slice(start: number, end?: number): Store<readonly T[]>;
	/** Reactive find — returns first item matching predicate. Caller should store the returned store. */
	find(predicate: (item: T) => boolean): Store<T | undefined>;

	/** JSON-serializable snapshot following the NodeV0 contract. */
	snapshot(): ListSnapshot<T>;

	/** Tear down all internal stores and caches. */
	destroy(): void;
}

let listCounter = 0;

/**
 * Creates a reactive ordered list with positional operations.
 *
 * @param initial - Initial items. Default: empty array.
 * @param opts - Optional configuration.
 *
 * @returns `ReactiveListResult<T>` — reactive items/length/version stores + positional operations.
 *
 * @remarks **Version-gated:** All derived stores recompute only when version changes.
 * @remarks **Structural propagation:** insert/remove/move/swap all bump version, triggering downstream updates.
 * @remarks **Lazy at() stores:** `at(index)` returns a cached derived store per index.
 * @remarks **Cached slice():** `slice(start, end)` caches by `(start, end)` pair.
 *
 * @example
 * ```ts
 * import { reactiveList } from 'callbag-recharge/data/reactiveList';
 *
 * const list = reactiveList([1, 2, 3]);
 * list.length.get(); // 3
 * list.push(4);
 * list.items.get(); // [1, 2, 3, 4]
 * ```
 *
 * @category data
 */
export function reactiveList<T>(
	initial: T[] = [],
	opts?: ReactiveListOptions,
): ReactiveListResult<T> {
	const counter = ++listCounter;
	const listId = opts?.id ?? `rlist-${counter}`;
	const prefix = opts?.name ?? listId;

	// Source of truth
	const _items: T[] = [...initial];

	// Version counter — bumped on every mutation
	const _version = state<number>(0, { name: `${prefix}:ver` });

	function bump(): void {
		_version.update((v) => v + 1);
	}

	// Reactive stores — lazy, version-gated
	const itemsStore: Store<readonly T[]> = derived([_version], () => [..._items] as readonly T[], {
		name: `${prefix}:items`,
	});

	const lengthStore: Store<number> = derived([_version], () => _items.length, {
		name: `${prefix}:length`,
	});

	// Cached at() and slice() stores
	const _atCache = new Map<number, Store<T | undefined>>();
	const _sliceCache = new Map<string, Store<readonly T[]>>();

	function get(index: number): T | undefined {
		return _items[index];
	}

	function set(index: number, value: T): void {
		if (index < 0 || index >= _items.length) return;
		_items[index] = value;
		bump();
	}

	function push(...items: T[]): void {
		if (items.length === 0) return;
		_items.push(...items);
		bump();
	}

	function pop(): T | undefined {
		if (_items.length === 0) return undefined;
		const item = _items.pop();
		bump();
		return item;
	}

	function insert(index: number, ...items: T[]): void {
		if (items.length === 0) return;
		if (index < 0) return;
		const idx = Math.min(index, _items.length);
		_items.splice(idx, 0, ...items);
		bump();
	}

	function remove(index: number, count = 1): T[] {
		if (index < 0 || index >= _items.length || count <= 0) return [];
		const removed = _items.splice(index, count);
		bump();
		return removed;
	}

	function move(from: number, to: number): void {
		if (from < 0 || from >= _items.length) return;
		if (to < 0 || to >= _items.length) return;
		if (from === to) return;
		const [item] = _items.splice(from, 1);
		_items.splice(to, 0, item);
		bump();
	}

	function swap(i: number, j: number): void {
		if (i < 0 || i >= _items.length) return;
		if (j < 0 || j >= _items.length) return;
		if (i === j) return;
		const tmp = _items[i];
		_items[i] = _items[j];
		_items[j] = tmp;
		bump();
	}

	function clear(): void {
		if (_items.length === 0) return;
		_items.length = 0;
		bump();
	}

	function at(index: number): Store<T | undefined> {
		let cached = _atCache.get(index);
		if (cached) return cached;
		cached = derived([_version], () => _items[index], {
			name: `${prefix}:at(${index})`,
		});
		_atCache.set(index, cached);
		return cached;
	}

	function slice(start: number, end?: number): Store<readonly T[]> {
		const key = `${start},${end ?? ""}`;
		let cached = _sliceCache.get(key);
		if (cached) return cached;
		cached = derived([_version], () => _items.slice(start, end) as readonly T[], {
			name: `${prefix}:slice(${key})`,
		});
		_sliceCache.set(key, cached);
		return cached;
	}

	function find(predicate: (item: T) => boolean): Store<T | undefined> {
		return derived([_version], () => _items.find(predicate), {
			name: `${prefix}:find`,
		});
	}

	function snapshot(): ListSnapshot<T> {
		return { type: "reactiveList", id: listId, version: _version.get(), items: [..._items] };
	}

	function destroy(): void {
		_items.length = 0;
		_atCache.clear();
		_sliceCache.clear();
	}

	return {
		id: listId,
		get version() {
			return _version.get();
		},
		items: itemsStore,
		length: lengthStore,
		versionStore: _version,
		get,
		set,
		push,
		pop,
		insert,
		remove,
		move,
		swap,
		clear,
		at,
		slice,
		find,
		snapshot,
		destroy,
	};
}
