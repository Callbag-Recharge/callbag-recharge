# last()

Emits the last value **when upstream completes** (no emission until END).

## Signature

```ts
function last<A>(): StoreOperator<A, A | undefined>
```

## Returns

`StoreOperator&lt;A, A | undefined&gt;` — Tier 1.
