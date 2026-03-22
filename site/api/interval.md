# interval()

Emits increasing integers `0, 1, 2, …` every `ms` milliseconds (Tier 2 source).

## Signature

```ts
function interval(ms: number, opts?: IntervalOptions): ProducerStore<number>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ms` | `number` | Tick interval. |
| `opts` | `IntervalOptions` | Optional configuration. |

## Returns

`ProducerStore&lt;number&gt;`
