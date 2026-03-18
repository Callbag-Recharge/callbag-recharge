# rescue()

On upstream error, switches to a fallback store returned by `fn(error)` (Tier 2).

## Signature

```ts
function rescue<A>(fn: (error: unknown) => Store<A>): StoreOperator<A, A>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `(error: unknown) =&gt; Store&lt;A&gt;` | Maps the error to a replacement `Store&lt;A&gt;`. |

## Returns

`StoreOperator&lt;A, A&gt;` — follows primary until error, then the fallback stream.

## See Also

- [retry](/api/retry)
