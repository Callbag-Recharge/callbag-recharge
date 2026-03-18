# timeout()

Forwards values while resetting an idle timer; if `ms` passes without DATA, errors with `TimeoutError` (Tier 2).

## Signature

```ts
function timeout<A>(ms: number): StoreOperator<A, A>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ms` | `number` | Maximum silence before failure. |

## Returns

`StoreOperator&lt;A, A&gt;`
