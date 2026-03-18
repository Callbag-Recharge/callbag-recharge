# throwError()

Fails immediately with `err` as the END error payload (Tier 2).

## Signature

```ts
function throwError<T = never>(err: unknown): ProducerStore<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `err` | `unknown` | Error value to propagate. |

## Returns

`ProducerStore&lt;T&gt;`
