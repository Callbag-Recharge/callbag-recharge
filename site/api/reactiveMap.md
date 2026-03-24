# reactiveMap()

Creates a reactive key-value store with point reads, reactive selects, and optional TTL.

## Signature

```ts
function reactiveMap<V>(opts?: ReactiveMapOptions<V>): ReactiveMap<V>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `ReactiveMapOptions&lt;V&gt;` | Optional configuration. |

## Returns

`ReactiveMap&lt;V&gt;` — key-value operations, reactive views, events, and lifecycle controls.

## Basic Usage

```ts
import { reactiveMap } from "callbag-recharge/data";

const users = reactiveMap<{ name: string }>();
users.set("u1", { name: "Ada" });
users.get("u1"); // { name: "Ada" }
```

## Options / Behavior Details

- **Single source of truth:** Internal `Map` is authoritative; reactive stores mirror map state.
- **Reactive views:** `select(key)`, `keysStore`, and `sizeStore` update through graph propagation.
- **TTL + eviction:** Supports per-key/default TTL and optional bounded-size eviction policies.

## Examples

### Reactive key subscription

```ts
const users = reactiveMap<number>();
const score = users.select("u1");

users.set("u1", 10);
score.get(); // 10
```

## See Also

- [reactiveIndex](./reactiveIndex)
- [reactiveLog](./reactiveLog)
- [compaction](./compaction)
