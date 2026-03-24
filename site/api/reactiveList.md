# reactiveList()

Creates a reactive ordered list with positional operations.

## Signature

```ts
function reactiveList<T>(
	initial: T[] = [],
	opts?: ReactiveListOptions,
): ReactiveListResult<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `initial` | `T[]` | Initial items. Default: empty array. |
| `opts` | `ReactiveListOptions` | Optional configuration. |

## Returns

`ReactiveListResult&lt;T&gt;` — reactive items/length/version stores + positional operations.

## Basic Usage

```ts
import { reactiveList } from 'callbag-recharge/data/reactiveList';

const list = reactiveList([1, 2, 3]);
list.length.get(); // 3
list.push(4);
list.items.get(); // [1, 2, 3, 4]
```

## Options / Behavior Details

- **Version-gated:** All derived stores recompute only when version changes.
- **Structural propagation:** insert/remove/move/swap all bump version, triggering downstream updates.
- **Lazy at() stores:** `at(index)` returns a cached derived store per index.
- **Cached slice():** `slice(start, end)` caches by `(start, end)` pair.
