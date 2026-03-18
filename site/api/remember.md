# remember()

Replays the last value to new subscribers; cache clears on last disconnect (`resetOnTeardown`) (Tier 1).

## Signature

```ts
function remember<A>(): StoreOperator<A, A | undefined>
```

## Returns

`StoreOperator&lt;A, A | undefined&gt;`
