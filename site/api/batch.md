# batch()

Runs `fn` while deferring type 1 (DATA) emissions until the outermost batch completes.
Type 3 (STATE) DIRTY signals still propagate immediately so the graph knows what changed.

## Signature

```ts
function batch<T>(fn: () => T): T
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `() =&gt; T` | Synchronous work that may call `set()` / `emit()` on many stores. |

## Returns

The return value of `fn`.

## Basic Usage

```ts
import { state, derived, batch } from 'callbag-recharge';

const a = state(1);
const b = state(2);
const sum = derived([a, b], () => a.get() + b.get());
batch(() => {
    a.set(10);
    b.set(20);
  });
sum.get(); // 30
```

## Options / Behavior Details

- **Nesting:** Inner batches increment depth; only the outermost `finally` drains deferred emissions.
- **Derived/effects:** Downstream nodes typically see one settled value per batch boundary.

## See Also

- [state](./state)
- [derived](./derived)
