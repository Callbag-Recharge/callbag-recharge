# reduce()

Folds a finite stream into one value, emitting **once** on upstream completion (Tier 2).

## Signature

```ts
function reduce<A, B>(reducer: (acc: B, value: A) => B, seed: B): StoreOperator<A, B>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `reducer` | `(acc: B, value: A) =&gt; B` | Pure fold; must not mutate `acc` if `seed` is mutable (use immutable updates). |
| `seed` | `B` | Initial accumulator; also emitted if upstream completes without DATA. |

## Returns

`StoreOperator&lt;A, B&gt;` — errors propagate without emission.

## Options / Behavior Details

- **Immutability:** Mutating `seed` breaks resubscribe semantics; prefer `[...acc, v]` or `toArray()`.

## See Also

- [toArray](/api/toArray)
- [scan](/api/scan)
