# toArray()

Collects all upstream values into one array, emitted **once** on completion (Tier 2).

## Signature

```ts
function toArray<A>(): StoreOperator<A, A[]>
```

## Returns

`StoreOperator&lt;A, A[]&gt;` — empty array if upstream completes without DATA.

## See Also

- [reduce](/api/reduce)
