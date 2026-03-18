# bufferTime()

Flushes accumulated values every `ms` milliseconds as an array (Tier 2).

## Signature

```ts
function bufferTime<A>(ms: number): StoreOperator<A, A[]>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ms` | `number` | Timer interval for flushes. |

## Returns

`StoreOperator&lt;A, A[]&gt;` — last flushed buffer from `get()`.

## See Also

- [buffer](/api/buffer)
