# cascadingCache()

Creates a singleton reactive cache with N-tier cascading lookup.

Each cached entry is a `state()` store. On cache miss, tiers are tried in order
(index 0 = hottest/fastest). When a lower tier hits, the value is auto-promoted
to all faster tiers. Concurrent lookups for the same key share the same state
instance — natural dedup without `keyedAsync`.

**Note:** `undefined` is used as the "not yet loaded" sentinel. Tiers that
return `undefined` are treated as cache misses. Do not store `undefined` as
a meaningful value.

## Signature

```ts
function cascadingCache<V>(
	tiers: CacheTier<V>[],
	opts?: CascadingCacheOptions,
): CascadingCache<V>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `tiers` | `CacheTier&lt;V&gt;[]` | Ordered lookup tiers, hottest first. |
| `opts` | `CascadingCacheOptions` | Optional configuration (maxSize, eviction policy, writeThrough). |

## Returns

`CascadingCache&lt;V&gt;` — a reactive cache where each entry is a `WritableStore&lt;V | undefined&gt;`.

## Basic Usage

```ts
import { cascadingCache } from 'callbag-recharge/utils';
import { subscribe } from 'callbag-recharge/extra';

const cache = cascadingCache([
    { load: k => memoryMap.get(k), save: (k, v) => memoryMap.set(k, v) },
    { load: k => fetch(`/api/${k}`).then(r => r.json()) },
  ]);

const user = cache.load("user:42"); // WritableStore<User | undefined>
subscribe(user, v => console.log("user:", v));
user.get(); // value or undefined (if async tier pending)
```
