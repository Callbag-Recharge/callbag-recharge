# find()

Emits the first value that satisfies `predicate`, then completes; no emission if upstream ends first.

## Signature

```ts
function find<A>(predicate: (value: A) => boolean): StoreOperator<A, A | undefined>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `predicate` | `(value: A) =&gt; boolean` | Test for each upstream value. |

## Returns

`StoreOperator&lt;A, A | undefined&gt;` — Tier 1.
