# retry()

Re-subscribes to the input store after errors, with optional count limit and backoff.

## Signature

```ts
function retry<A>(config: number | RetryOptions): StoreOperator<A, A>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `number | RetryOptions` | Shorthand `number` (max retries) or `{ count, delay, while }`. |

### RetryOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `count` | `number` | `varies` | Max retries; with `delay`, default is unbounded unless set. |
| `delay` | `BackoffStrategy` | `undefined` | Milliseconds between attempts; `null` from strategy stops. |
| `while` | `(err) =&gt; boolean` | `undefined` | Retry only when predicate holds. |

## Returns

`StoreOperator&lt;A, A&gt;` — Tier 2; clean completion ends retries.

## See Also

- [rescue](/api/rescue)
- [repeat](/api/repeat)
