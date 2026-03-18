# delay()

Shifts each upstream value forward in time by `ms` (independent timer per value).

## Signature

```ts
function delay<A>(ms: number): StoreOperator<A, A | undefined>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ms` | `number` | Delay in milliseconds. |

## Returns

`StoreOperator&lt;A, A | undefined&gt;` — Tier 2; may reorder rapid bursts by completion time.

## See Also

- [debounce](/api/debounce)
