# fromTimer()

Creates a raw callbag source that emits `undefined` once after a delay,
then completes (END). If the signal is already aborted or aborts during
the delay, emits immediately.

Use with `firstValueFrom` to replace raw `new Promise` + `setTimeout`.

## Signature

```ts
function fromTimer(ms: number, signal?: AbortSignal): CallbagSource
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `ms` | `number` | Delay in milliseconds. |
| `signal` | `AbortSignal` | Optional AbortSignal to cancel the delay early. |

## Returns

A raw callbag source function.
