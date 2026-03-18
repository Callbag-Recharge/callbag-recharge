# fromEvent()

DOM event source: each matching event becomes a DATA emission (Tier 2).

## Signature

```ts
function fromEvent<T extends Event = Event>(
	target: EventTarget,
	eventName: string,
): ProducerStore<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `target` | `EventTarget` | `EventTarget` to listen on. |
| `eventName` | `string` | Event type string. |

## Returns

`ProducerStore&lt;T&gt;`
