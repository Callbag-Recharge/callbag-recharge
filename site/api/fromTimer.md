# fromTimer()

Creates a raw callbag source that emits `undefined` once after a delay,
then completes (END). If the signal is already aborted or aborts during
the delay, sends END with the abort reason as an error (no DATA emitted).

Use with `rawSubscribe` to replace raw `new Promise` + `setTimeout`.
Use `firstValueFrom` only at system boundaries when exiting callbag-land.

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
