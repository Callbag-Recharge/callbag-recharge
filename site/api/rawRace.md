# rawRace()

Mirrors the first raw callbag source that emits a value; sends END to
the losers and follows the winner thereafter.

## Signature

```ts
function rawRace(...sources: CallbagSource[]): CallbagSource
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sources` | `CallbagSource[]` | Competing raw callbag sources. |

## Returns

A raw callbag source function.

## Options / Behavior Details

- **Empty:** Completes immediately if `sources` is empty.
- **Errors:** If a source errors before any DATA, the error propagates.
- **Losers:** Errors from non-winner sources after a winner is chosen are silently
dropped (matches `Promise.race` semantics).
