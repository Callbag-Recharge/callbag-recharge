# forEach()

Curried sink: `forEach(cb)(store)` runs `cb` on each DATA after subscribe; returns unsubscribe.

## Signature

```ts
function forEach<T>(cb: (value: T) => void): (store: Store<T>) => () => void
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `cb` | `(value: T) =&gt; void` | Side effect per value. |

## Returns

Function taking `Store&lt;T&gt;` and returning `() =&gt; void` unsubscribe.

## See Also

- [subscribe](/api/subscribe)
