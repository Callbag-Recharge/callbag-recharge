# takeUntil()

Mirrors upstream until the notifier becomes dirty, then completes and tears down input (Tier 1-style wiring).

## Signature

```ts
function takeUntil<A>(notifier: Store<unknown>): StoreOperator<A, A>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `notifier` | `Store&lt;unknown&gt;` | First DIRTY from notifier ends the stream (before notifier DATA in the same batch). |

## Returns

`StoreOperator&lt;A, A&gt;` — frozen last value after completion.
