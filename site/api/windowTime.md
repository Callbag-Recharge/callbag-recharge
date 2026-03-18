# windowTime()

Time-based windows: new inner store every `ms` (Tier 2).

## Signature

```ts
function windowTime<A>(ms: number): StoreOperator<A, Store<A> | undefined>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ms` | `number` | Window duration in milliseconds. |

## Returns

`StoreOperator&lt;A, Store&lt;A&gt; | undefined&gt;`
