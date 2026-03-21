# priorityQueue()

Create a min-heap priority queue.

## Signature

```ts
function priorityQueue<T>(comparator: (a: T, b: T) => number): PriorityQueue<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `comparator` | `(a: T, b: T) =&gt; number` | Comparison function. Negative return means `a` is extracted before `b`. |

## Returns

`PriorityQueue&lt;T&gt;` — array-backed binary min-heap with O(log n) push/poll.

## Basic Usage

```ts
import { priorityQueue } from 'callbag-recharge/utils';

const pq = priorityQueue<number>((a, b) => a - b);
pq.push(5); pq.push(1); pq.push(3);
pq.poll(); // 1
pq.peek(); // 3
pq.drain(); // [3, 5]
```

## Options / Behavior Details

- **Non-reactive:** Pure data structure with no store dependencies. Intended as internal infrastructure for ordered dispatch in topic, pipeline, and jobQueue.
