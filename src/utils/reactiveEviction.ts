// ---------------------------------------------------------------------------
// Reactive Scored Eviction — O(log n) min-heap, score-push driven
// ---------------------------------------------------------------------------
// Unlike scored() which recomputes all scores at eviction time (O(n)),
// this policy maintains a live min-heap backed by reactive score stores.
// When a score store emits a new value, the key is sifted to its new heap
// position in O(log n). evict(1) is then O(log n) extract-min.
//
// Complexity:
//   insert  — O(log n): push + sift up + subscribe
//   touch   — O(1) no-op: scores are pushed reactively, not pulled
//   delete  — O(log n): unsubscribe + remove-at + sift
//   evict   — O(k log n): k extract-mins
//   update  — O(log n): triggered automatically on score store emission
//
// vs scored():
//   insert  — O(1)
//   delete  — O(1)
//   evict   — O(n) scan [evict(1)] or O(n log n) sort [evict(k)]
//
// Use reactiveScored when: collection is large, scores change frequently
//   (regular touch()/setImportance()), evictions are infrequent.
// Use scored() when: collection is small (< ~50 keys) or scores are static.
//
// Time approximation note:
//   Scores are computed at the moment of the LAST metadata change, not at
//   eviction time. Recency decay continues to pass, so the heap may slightly
//   underestimate how stale a node has become. The heap still evicts the
//   correct relative order among nodes with similar last-touched times.
// ---------------------------------------------------------------------------

import { subscribe } from "../core/subscribe";
import type { Store } from "../core/types";
import type { EvictionPolicy } from "./eviction";

interface HeapEntry<K> {
	key: K;
	score: number;
	index: number; // current position in _heap array — kept in sync by _swap
}

export function reactiveScored<K, S = number>(
	getStore: (key: K) => Store<S>,
	scoreOf: (value: S) => number = (x) => x as unknown as number,
): EvictionPolicy<K> {
	const _heap: HeapEntry<K>[] = [];
	const _entries = new Map<K, HeapEntry<K>>();
	const _disposes = new Map<K, () => void>();

	// ---- Heap primitives ----

	function _swap(i: number, j: number): void {
		const a = _heap[i];
		const b = _heap[j];
		_heap[i] = b;
		_heap[j] = a;
		a.index = j;
		b.index = i;
	}

	function _siftUp(i: number): void {
		while (i > 0) {
			const p = (i - 1) >>> 1;
			if (_heap[p].score <= _heap[i].score) break;
			_swap(i, p);
			i = p;
		}
	}

	function _siftDown(i: number): void {
		const n = _heap.length;
		while (true) {
			let min = i;
			const l = 2 * i + 1;
			const r = l + 1;
			if (l < n && _heap[l].score < _heap[min].score) min = l;
			if (r < n && _heap[r].score < _heap[min].score) min = r;
			if (min === i) break;
			_swap(i, min);
			i = min;
		}
	}

	// Remove the entry at index i in O(log n).
	function _removeAt(i: number): void {
		const last = _heap.length - 1;
		if (i === last) {
			_heap.pop();
			return;
		}
		_swap(i, last);
		_heap.pop();
		// Swapped element may need to go either direction
		_siftUp(i);
		_siftDown(i);
	}

	// ---- Policy ----

	return {
		// No-op: score updates are pushed reactively via subscriptions
		touch() {},

		insert(key) {
			if (_entries.has(key)) return;

			const store = getStore(key);
			const entry: HeapEntry<K> = {
				key,
				score: scoreOf(store.get()),
				index: _heap.length,
			};
			_heap.push(entry);
			_entries.set(key, entry);
			_siftUp(entry.index);

			// Subscribe: when store emits, compute score and sift to new position.
			// Uses subscribe (callbag sink) instead of effect — no DIRTY/RESOLVED
			// overhead, no eager first run, no cleanup return handling.
			const sub = subscribe(
				store,
				(value) => {
					const e = _entries.get(key);
					if (!e) return;
					const prev = e.score;
					e.score = scoreOf(value);
					if (e.score < prev) _siftUp(e.index);
					else if (e.score > prev) _siftDown(e.index);
				},
				{
					// If the score store completes (END), clean up the heap entry
					// to prevent zombie entries that are never evicted.
					onEnd: () => {
						const entry = _entries.get(key);
						if (!entry) return;
						_removeAt(entry.index);
						_entries.delete(key);
						_disposes.delete(key);
					},
				},
			);
			_disposes.set(key, () => sub.unsubscribe());
		},

		delete(key) {
			const entry = _entries.get(key);
			if (!entry) return;

			// Unsubscribe first so no callbacks fire during removal
			const dispose = _disposes.get(key);
			if (dispose) {
				dispose();
				_disposes.delete(key);
			}

			_removeAt(entry.index);
			_entries.delete(key);
		},

		evict(count = 1) {
			const result: K[] = [];
			while (result.length < count && _heap.length > 0) {
				const { key } = _heap[0];
				result.push(key);

				// Inline deletion of heap[0] — avoids double _entries.get lookup
				const dispose = _disposes.get(key);
				if (dispose) {
					dispose();
					_disposes.delete(key);
				}
				_removeAt(0);
				_entries.delete(key);
			}
			return result;
		},

		size: () => _entries.size,

		clear() {
			for (const dispose of _disposes.values()) dispose();
			_disposes.clear();
			_entries.clear();
			_heap.length = 0;
		},
	};
}
