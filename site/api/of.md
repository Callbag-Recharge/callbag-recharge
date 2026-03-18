# of()

Synchronously emits each argument in order, then completes (Tier 2).

## Signature

```ts
function of<T>(...values: T[]): ProducerStore<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `values` | `T[]` | Values to emit. |

## Returns

`ProducerStore&lt;T&gt;`
