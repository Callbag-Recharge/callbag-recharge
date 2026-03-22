# fromTimer()

Creates a callbag source that emits `undefined` once after a delay,
then completes. If the signal is already aborted or aborts during the
delay, emits immediately.

Use with `firstValueFrom` to replace raw `new Promise` + `setTimeout`.

## Signature

```ts
function fromTimer(ms: number, signal?: AbortSignal): ProducerStore<void>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ms` | `number` | Delay in milliseconds. |
| `signal` | `AbortSignal` | Optional AbortSignal to cancel the delay early. |

## Returns

`ProducerStore&lt;void&gt;` — emits once, completes.
