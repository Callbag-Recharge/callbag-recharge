# lightCollection()

Creates a lightweight reactive collection that uses FIFO or LRU eviction
instead of decay-scored reactive eviction. Same `Collection&lt;T&gt;` interface
as `collection()` — drop-in replacement for high-throughput paths.

## Signature

```ts
function lightCollection<T>(opts?: LightCollectionOptions<T>): CollectionInterface<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `LightCollectionOptions&lt;T&gt;` | Optional configuration. |

### LightCollectionOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `maxSize` | `number` | `Infinity` | Maximum nodes. Evicted by FIFO or LRU on overflow. |
| `eviction` | `"fifo" \` | `"lru"` | "fifo" |
| `weights` | `ScoreWeights` | `{}` | Default weights for topK scoring (eviction does NOT use scores). |
| `admissionPolicy` | `AdmissionPolicyFn&lt;T&gt;` | `undefined` | Gate every add(). |
| `forgetPolicy` | `ForgetPolicyFn&lt;T&gt;` | `undefined` | Predicate run before each add() and during gc(). |

## Returns

`Collection&lt;T&gt;` — identical interface to `collection()`.

## Basic Usage

```ts
import { lightCollection } from 'callbag-recharge/memory';

// FIFO buffer — oldest out
const buf = lightCollection<string>({ maxSize: 1000 });

// LRU cache — least-recently-used out
const cache = lightCollection<string>({ maxSize: 100, eviction: "lru" });
```

## Options / Behavior Details

- **FIFO** evicts the oldest-inserted node regardless of access. **LRU** evicts the least-recently-accessed node — `get()` counts as an access.
- **No per-node subscriptions.** Unlike `collection()` which subscribes to every node's `.meta` for reactive score updates, `lightCollection` has zero per-node overhead beyond tag tracking.

## See Also

- [collection](./collection) — decay-scored eviction
- [memoryNode](./memoryNode) — individual memory node
