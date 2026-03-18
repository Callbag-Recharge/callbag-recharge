# groupBy()

Partitions upstream into a reactive `Map` of per-key stores (Tier 2).

## Signature

```ts
function groupBy<A, K>(keyFn: (value: A) => K): StoreOperator<A, Map<K, Store<A>>>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `keyFn` | `(value: A) =&gt; K` | Group key for each value. |

## Returns

`StoreOperator&lt;A, Map&lt;K, Store&lt;A&gt;&gt;&gt;`
