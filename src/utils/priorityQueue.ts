// ---------------------------------------------------------------------------
// PriorityQueue<T> — array-backed binary min-heap
// ---------------------------------------------------------------------------
// Pure data structure for ordered dispatch. O(log n) insert/extract-min.
// Non-reactive — no callbag/store dependencies.
//
// Usage:
//   const pq = priorityQueue<number>((a, b) => a - b);
//   pq.push(5); pq.push(1); pq.push(3);
//   pq.poll(); // 1
//   pq.poll(); // 3
// ---------------------------------------------------------------------------

/**
 * Options for creating a priority queue.
 */
export interface PriorityQueueOptions<T> {
	/** Comparator function. Negative return = a has higher priority (extracted first). */
	comparator: (a: T, b: T) => number;
}

/**
 * A min-heap priority queue.
 */
export interface PriorityQueue<T> {
	/** Insert an item. O(log n). */
	push(item: T): void;
	/** Remove and return the highest-priority (min) item. O(log n). Returns undefined if empty. */
	poll(): T | undefined;
	/** Return the highest-priority item without removing it. O(1). */
	peek(): T | undefined;
	/** Current number of items. */
	readonly size: number;
	/** Whether the queue is empty. */
	readonly isEmpty: boolean;
	/** Remove all items and return them in priority order. */
	drain(): T[];
	/** Remove all items. */
	clear(): void;
}

/**
 * Create a min-heap priority queue.
 *
 * @param comparator - Comparison function. Negative return means `a` is extracted before `b`.
 *
 * @returns `PriorityQueue<T>` — array-backed binary min-heap with O(log n) push/poll.
 *
 * @remarks **Non-reactive:** Pure data structure with no store dependencies. Intended as internal infrastructure for ordered dispatch in topic, pipeline, and jobQueue.
 *
 * @example
 * ```ts
 * import { priorityQueue } from 'callbag-recharge/utils';
 *
 * const pq = priorityQueue<number>((a, b) => a - b);
 * pq.push(5); pq.push(1); pq.push(3);
 * pq.poll(); // 1
 * pq.peek(); // 3
 * pq.drain(); // [3, 5]
 * ```
 *
 * @category utils
 */
export function priorityQueue<T>(comparator: (a: T, b: T) => number): PriorityQueue<T> {
	const _heap: T[] = [];

	function _siftUp(i: number): void {
		while (i > 0) {
			const parent = (i - 1) >>> 1;
			if (comparator(_heap[i], _heap[parent]) >= 0) break;
			const tmp = _heap[i];
			_heap[i] = _heap[parent];
			_heap[parent] = tmp;
			i = parent;
		}
	}

	function _siftDown(i: number): void {
		const n = _heap.length;
		while (true) {
			let smallest = i;
			const left = 2 * i + 1;
			const right = 2 * i + 2;
			if (left < n && comparator(_heap[left], _heap[smallest]) < 0) smallest = left;
			if (right < n && comparator(_heap[right], _heap[smallest]) < 0) smallest = right;
			if (smallest === i) break;
			const tmp = _heap[i];
			_heap[i] = _heap[smallest];
			_heap[smallest] = tmp;
			i = smallest;
		}
	}

	return {
		push(item: T): void {
			_heap.push(item);
			_siftUp(_heap.length - 1);
		},

		poll(): T | undefined {
			if (_heap.length === 0) return undefined;
			const top = _heap[0];
			const last = _heap.pop()!;
			if (_heap.length > 0) {
				_heap[0] = last;
				_siftDown(0);
			}
			return top;
		},

		peek(): T | undefined {
			return _heap[0];
		},

		get size() {
			return _heap.length;
		},

		get isEmpty() {
			return _heap.length === 0;
		},

		drain(): T[] {
			const result: T[] = [];
			while (_heap.length > 0) {
				// Use inline poll logic to avoid this-binding issues on destructure
				const top = _heap[0];
				const last = _heap.pop()!;
				if (_heap.length > 0) {
					_heap[0] = last;
					_siftDown(0);
				}
				result.push(top);
			}
			return result;
		},

		clear(): void {
			_heap.length = 0;
		},
	};
}
