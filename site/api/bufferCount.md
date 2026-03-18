# bufferCount()

Flushes every `count` values as an array; optional `startEvery` enables overlapping (sliding) buffers.

## Signature

```ts
function bufferCount<A>(count: number, startEvery?: number): StoreOperator<A, A[]>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `count` | `number` | Buffer size before flush. |
| `startEvery` | `number` | If set, start a new buffer every N emissions (sliding); omit for tumbling windows. |

## Returns

`StoreOperator&lt;A, A[]&gt;` — Tier 2.
