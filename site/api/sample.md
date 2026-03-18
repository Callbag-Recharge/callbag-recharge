# sample()

On each notifier emission, emits the **latest** value from the primary input (Tier 2).

## Signature

```ts
function sample<A>(notifier: Store<unknown>): StoreOperator<A, A>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `notifier` | `Store&lt;unknown&gt;` | Sampling clock store. |

## Returns

`StoreOperator&lt;A, A&gt;` — `get()` reflects latest input, not only last sample.
