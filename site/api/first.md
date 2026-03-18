# first()

Emits the first upstream value then completes (same idea as `take(1)`).

## Signature

```ts
function first<A>(): StoreOperator<A, A | undefined>
```

## Returns

`StoreOperator&lt;A, A | undefined&gt;` — Tier 1.

## See Also

- [take](/api/take)
