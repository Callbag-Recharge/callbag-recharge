# pairwise()

Emits `[previous, current]` for each upstream value after the first (Tier 1).

## Signature

```ts
function pairwise<A>(): StoreOperator<A, [A, A] | undefined>
```

## Returns

`StoreOperator&lt;A, [A, A] | undefined&gt;`
