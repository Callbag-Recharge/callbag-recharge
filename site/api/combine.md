# combine()

Builds a tuple store from multiple sources; updates when any dep changes (multi-dep Tier 1).

## Signature

```ts
function combine<Sources extends Store<unknown>[]>(
	...sources: Sources
): Store<{ [K in keyof Sources]: Sources[K] extends Store<infer T> ? T : never }>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sources` | `Sources` | Stores whose values become tuple elements in order. |

## Returns

`Store&lt;[...]&gt;` — typed tuple of each store’s `T`.

## Basic Usage

```ts
import { state } from 'callbag-recharge';
import { combine } from 'callbag-recharge/extra';

const a = state(1);
const b = state(2);
const c = combine(a, b);
c.get(); // [1, 2]
```

## Options / Behavior Details

- **New array:** Each recompute uses a fresh tuple reference.
- **Fail-fast:** Terminates when any source ends (error or completion).

## See Also

- [merge](/api/merge)
- [withLatestFrom](/api/withLatestFrom) — latest value from secondary sources
