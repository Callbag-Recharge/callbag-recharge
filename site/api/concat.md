# concat()

Plays sources one after another: the next source subscribes only after the previous completes.

## Signature

```ts
function concat<T>(...sources: Store<T>[]): Store<T | undefined>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sources` | `Store&lt;T&gt;[]` | Ordered list of `Store&lt;T&gt;`. |

## Returns

`Store&lt;T | undefined&gt;` — Tier 2; value is from whichever source is currently active.

## Options / Behavior Details

- **STATE:** Forwards control signals from the active source only.

## See Also

- [merge](/api/merge)
- [concatMap](/api/concatMap)
