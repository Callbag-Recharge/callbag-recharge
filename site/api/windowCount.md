# windowCount()

Fixed-size counting windows: each inner store receives up to `count` values (Tier 2).

## Signature

```ts
function windowCount<A>(count: number): StoreOperator<A, Store<A> | undefined>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `count` | `number` | Values per window before rotating. |

## Returns

`StoreOperator&lt;A, Store&lt;A&gt; | undefined&gt;`
