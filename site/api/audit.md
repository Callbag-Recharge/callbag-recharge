# audit()

Trailing-edge sample: after a value arrives, waits `ms` then emits the **latest** value seen in that window (Tier 2).

## Signature

```ts
function audit<A>(ms: number): StoreOperator<A, A | undefined>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ms` | `number` | Silence period before emitting the most recent upstream value. |

## Returns

`StoreOperator&lt;A, A | undefined&gt;`

## See Also

- [throttle](/api/throttle)
- [sample](/api/sample)
