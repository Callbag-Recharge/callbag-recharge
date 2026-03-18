# teardown()

Completes a store-like node and cascades END to all downstream sinks (and tears down the subgraph).
After teardown, the node will not accept new subscriptions or values in the usual way.

## Signature

```ts
function teardown(store: { source: (type: number, payload?: any) => void }): void
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `store` | `{ source: (type: number, payload?: any) =&gt; void }` | Any node with `source` and optionally `complete()` or internal `_handleEnd` (e.g. derived). |

## Basic Usage

```ts
import { producer, teardown } from 'callbag-recharge';

const s = producer<number>();
teardown(s);
```

## Options / Behavior Details

- **Producers:** Calls `complete()` when available. **Derived:** Uses `_handleEnd` when present.

## See Also

- [producer](./producer)
