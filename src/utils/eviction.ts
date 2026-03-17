// ---------------------------------------------------------------------------
// Eviction Policies — pure bookkeeping for bounded data structures
// ---------------------------------------------------------------------------
// Tracks access/insertion patterns and decides eviction order.
// Does NOT hold values — just keys. Data structures own their storage.
//
// Interface:
//   touch(key)   — record an access (read/write)
//   insert(key)  — record a new insertion
//   delete(key)  — record a deletion
//   evict(count) — return key(s) to evict (default 1)
// ---------------------------------------------------------------------------

export interface EvictionPolicy<K> {
	/** Record an access (read or write hit). */
	touch(key: K): void;
	/** Record a new key insertion. */
	insert(key: K): void;
	/** Record a key deletion (external cleanup). */
	delete(key: K): void;
	/** Return keys to evict. Default count = 1. */
	evict(count?: number): K[];
	/** Current number of tracked keys. */
	size(): number;
	/** Clear all tracking state. */
	clear(): void;
}

// ---------------------------------------------------------------------------
// FIFO — First In, First Out
// ---------------------------------------------------------------------------

export function fifo<K>(): EvictionPolicy<K> {
	const _queue: K[] = [];
	const _alive = new Set<K>();
	let _head = 0; // read pointer — avoids O(n) shift()

	return {
		touch() {},
		insert(key) {
			if (_alive.has(key)) return;
			_queue.push(key);
			_alive.add(key);
		},
		delete(key) {
			// Lazy deletion — O(1). Dead entries skipped during evict.
			_alive.delete(key);
		},
		evict(count = 1) {
			const result: K[] = [];
			while (result.length < count && _head < _queue.length) {
				const key = _queue[_head++];
				if (_alive.delete(key)) {
					result.push(key);
				}
				// else: dead entry, skip
			}
			// Compact when read pointer passes half the queue and queue is large
			if (_head > 1000 && _head > _queue.length / 2) {
				_queue.splice(0, _head);
				_head = 0;
			}
			return result;
		},
		size: () => _alive.size,
		clear() {
			_queue.length = 0;
			_alive.clear();
			_head = 0;
		},
	};
}

// ---------------------------------------------------------------------------
// LRU — Least Recently Used (doubly-linked list + Map for O(1))
// ---------------------------------------------------------------------------

interface LRUNode<K> {
	key: K;
	prev: LRUNode<K> | null;
	next: LRUNode<K> | null;
}

export function lru<K>(): EvictionPolicy<K> {
	const _map = new Map<K, LRUNode<K>>();
	// Sentinel head/tail for cleaner edge handling
	const _head: LRUNode<K> = { key: null as any, prev: null, next: null };
	const _tail: LRUNode<K> = { key: null as any, prev: null, next: null };
	_head.next = _tail;
	_tail.prev = _head;

	function _remove(node: LRUNode<K>): void {
		node.prev!.next = node.next;
		node.next!.prev = node.prev;
	}

	function _addToFront(node: LRUNode<K>): void {
		node.next = _head.next;
		node.prev = _head;
		_head.next!.prev = node;
		_head.next = node;
	}

	function _moveToFront(node: LRUNode<K>): void {
		_remove(node);
		_addToFront(node);
	}

	return {
		touch(key) {
			const node = _map.get(key);
			if (node) _moveToFront(node);
		},
		insert(key) {
			let node = _map.get(key);
			if (node) {
				_moveToFront(node);
				return;
			}
			node = { key, prev: null, next: null };
			_map.set(key, node);
			_addToFront(node);
		},
		delete(key) {
			const node = _map.get(key);
			if (!node) return;
			_remove(node);
			_map.delete(key);
		},
		evict(count = 1) {
			const result: K[] = [];
			while (result.length < count && _tail.prev !== _head) {
				const node = _tail.prev!;
				result.push(node.key);
				_remove(node);
				_map.delete(node.key);
			}
			return result;
		},
		size: () => _map.size,
		clear() {
			_map.clear();
			_head.next = _tail;
			_tail.prev = _head;
		},
	};
}

// ---------------------------------------------------------------------------
// LFU — Least Frequently Used
// ---------------------------------------------------------------------------
// True O(1) implementation using a doubly-linked list of frequency buckets.
//
// Structure:
//   _head ↔ [freq=1, keys] ↔ [freq=3, keys] ↔ [freq=7, keys] ↔ _tail
//
// - List is always sorted ascending by freq (gaps are fine — unused freqs
//   simply don't have a bucket node).
// - _head.next is always the minimum-frequency bucket. No scan needed.
// - Each key maps directly to its bucket node via _keyBucket Map.
//
// All operations O(1):
//   touch  — move key from bucket[f] to bucket[f+1], insert f+1 after f if new
//   insert — add key to bucket[1], insert at head if bucket[1] doesn't exist
//   delete — remove key from bucket, remove empty bucket from list
//   evict  — take from _head.next bucket
// ---------------------------------------------------------------------------

interface LFUBucket<K> {
	freq: number;
	keys: Set<K>;
	prev: LFUBucket<K>;
	next: LFUBucket<K>;
}

export function lfu<K>(): EvictionPolicy<K> {
	// _keyBucket: O(1) lookup of a key's bucket
	const _keyBucket = new Map<K, LFUBucket<K>>();

	// Sentinel head/tail — list sorted ascending by freq between them
	const _head = {} as LFUBucket<K>;
	const _tail = {} as LFUBucket<K>;
	_head.next = _tail;
	_tail.prev = _head;

	function _insertAfter(anchor: LFUBucket<K>, node: LFUBucket<K>): void {
		node.prev = anchor;
		node.next = anchor.next;
		anchor.next.prev = node;
		anchor.next = node;
	}

	function _removeBucket(bucket: LFUBucket<K>): void {
		bucket.prev.next = bucket.next;
		bucket.next.prev = bucket.prev;
	}

	// Get or create the bucket for `freq`, which must be inserted right after `anchor`.
	// Caller guarantees anchor.freq < freq < anchor.next.freq (or anchor.next === _tail).
	function _bucketAfter(anchor: LFUBucket<K>, freq: number): LFUBucket<K> {
		if (anchor.next !== _tail && anchor.next.freq === freq) return anchor.next;
		const bucket = { freq, keys: new Set<K>() } as LFUBucket<K>;
		_insertAfter(anchor, bucket);
		return bucket;
	}

	return {
		touch(key) {
			const bucket = _keyBucket.get(key);
			if (!bucket) return;
			// Move key to bucket[freq+1], inserted right after current bucket
			const next = _bucketAfter(bucket, bucket.freq + 1);
			bucket.keys.delete(key);
			next.keys.add(key);
			_keyBucket.set(key, next);
			if (bucket.keys.size === 0) _removeBucket(bucket);
		},
		insert(key) {
			if (_keyBucket.has(key)) {
				this.touch(key);
				return;
			}
			// Bucket[1] is always at the head of the list
			const bucket = _bucketAfter(_head, 1);
			bucket.keys.add(key);
			_keyBucket.set(key, bucket);
		},
		delete(key) {
			const bucket = _keyBucket.get(key);
			if (!bucket) return;
			bucket.keys.delete(key);
			_keyBucket.delete(key);
			if (bucket.keys.size === 0) _removeBucket(bucket);
		},
		evict(count = 1) {
			const result: K[] = [];
			while (result.length < count && _head.next !== _tail) {
				const minBucket = _head.next;
				const key = minBucket.keys.values().next().value!;
				result.push(key);
				minBucket.keys.delete(key);
				_keyBucket.delete(key);
				if (minBucket.keys.size === 0) _removeBucket(minBucket);
			}
			return result;
		},
		size: () => _keyBucket.size,
		clear() {
			_keyBucket.clear();
			_head.next = _tail;
			_tail.prev = _head;
		},
	};
}

// ---------------------------------------------------------------------------
// Scored — Custom score function, evict lowest scores
// ---------------------------------------------------------------------------

export function scored<K>(scoreFn: (key: K) => number): EvictionPolicy<K> {
	const _keys = new Set<K>();

	function _safeScore(key: K): number {
		try {
			return scoreFn(key);
		} catch {
			return -Infinity; // corrupted → evict first
		}
	}

	return {
		touch() {},
		insert(key) {
			_keys.add(key);
		},
		delete(key) {
			_keys.delete(key);
		},
		evict(count = 1) {
			if (_keys.size === 0) return [];

			// Fast path: single eviction — O(n) scan instead of O(n log n) sort
			if (count === 1) {
				let minKey: K | undefined;
				let minScore = Infinity;
				for (const key of _keys) {
					const s = _safeScore(key);
					if (s < minScore) {
						minScore = s;
						minKey = key;
					}
				}
				if (minKey !== undefined) {
					_keys.delete(minKey);
					return [minKey];
				}
				return [];
			}

			// General case: sort all
			const entries = Array.from(_keys).map((key) => ({
				key,
				score: _safeScore(key),
			}));
			entries.sort((a, b) => a.score - b.score);
			const result = entries.slice(0, count).map((e) => e.key);
			for (const key of result) _keys.delete(key);
			return result;
		},
		size: () => _keys.size,
		clear() {
			_keys.clear();
		},
	};
}

// ---------------------------------------------------------------------------
// Random — Random eviction
// ---------------------------------------------------------------------------

export function random<K>(): EvictionPolicy<K> {
	const _keys: K[] = [];
	const _index = new Map<K, number>(); // key → index for O(1) delete

	return {
		touch() {},
		insert(key) {
			if (_index.has(key)) return;
			_index.set(key, _keys.length);
			_keys.push(key);
		},
		delete(key) {
			const idx = _index.get(key);
			if (idx === undefined) return;
			// Swap with last for O(1) removal
			const last = _keys[_keys.length - 1];
			_keys[idx] = last;
			_index.set(last, idx);
			_keys.pop();
			_index.delete(key);
		},
		evict(count = 1) {
			const result: K[] = [];
			while (result.length < count && _keys.length > 0) {
				const idx = Math.floor(Math.random() * _keys.length);
				const key = _keys[idx];
				result.push(key);
				// Swap with last for O(1) removal
				const last = _keys[_keys.length - 1];
				_keys[idx] = last;
				_index.set(last, idx);
				_keys.pop();
				_index.delete(key);
			}
			return result;
		},
		size: () => _keys.length,
		clear() {
			_keys.length = 0;
			_index.clear();
		},
	};
}
