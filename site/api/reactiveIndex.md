# reactiveIndex()

Creates a reactive secondary index from index key to sets of primary keys.

## Signature

```ts
function reactiveIndex(opts?: ReactiveIndexCreateOptions): ReactiveIndex
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `ReactiveIndexCreateOptions` | Optional configuration. |

## Returns

`ReactiveIndex` — reverse mapping queries, reactive selectors, mutation helpers, and snapshot APIs.

## Basic Usage

```ts
import { reactiveIndex } from "callbag-recharge/data";

const byTag = reactiveIndex();
byTag.add("u1", ["admin", "active"]);
byTag.get("admin"); // Set { "u1" }
```

## Options / Behavior Details

- **Reverse map:** Tracks primary key to index keys for efficient `remove()` and `update()`.
- **Reactive selectors:** `select(indexKey)` returns cached stores for index-key membership updates.
- **Structural versioning:** `keysStore`/`sizeStore` are version-gated and update on keyset changes.

## Examples

### Update indexed keys

```ts
const byTag = reactiveIndex();
byTag.add("u1", ["admin"]);
byTag.update("u1", ["editor"]);

byTag.get("admin").size; // 0
byTag.get("editor").size; // 1
```

## See Also

- [reactiveMap](./reactiveMap)
- [reactiveList](./reactiveList)
- [pubsub](./pubsub)
