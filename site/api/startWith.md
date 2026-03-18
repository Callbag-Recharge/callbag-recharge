# startWith()

Uses `initial` whenever upstream is `undefined`; once upstream is defined, passes it through (Tier 1).

## Signature

```ts
function startWith<A>(initial: A, opts?: StoreOptions): StoreOperator<A | undefined, A>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `initial` | `A` | Fallback value for `undefined` upstream. |
| `opts` | `StoreOptions` | Optional `StoreOptions`. |

## Returns

`StoreOperator&lt;A | undefined, A&gt;`
