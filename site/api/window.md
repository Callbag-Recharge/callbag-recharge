# window()

Multiplexes upstream into per-window writable stores; notifier edges close/open windows (Tier 2).

## Signature

```ts
function window<A>(notifier: Store<unknown>): StoreOperator<A, Store<A> | undefined>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `notifier` | `Store&lt;unknown&gt;` | Emissions delimit windows. |

## Returns

`StoreOperator&lt;A, Store&lt;A&gt; | undefined&gt;` — current window store.
