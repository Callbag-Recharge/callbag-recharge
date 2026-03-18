# repeat()

Re-subscribes to `factory()` on each **clean** completion; optional `count` caps total rounds (Tier 2).

## Signature

```ts
function repeat<T>(factory: () => Store<T>, count?: number): Store<T | undefined>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `factory` | `() =&gt; Store&lt;T&gt;` | Returns a fresh `Store&lt;T&gt;` per subscription. |
| `count` | `number` | Max subscription rounds (omit for infinite repeat). |

## Returns

`Store&lt;T | undefined&gt;` — errors are **not** retried (use `retry`).

## See Also

- [retry](/api/retry)
