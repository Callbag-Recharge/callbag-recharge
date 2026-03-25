# firstValueFrom()

Subscribes to a raw callbag source and resolves with the first value
matching the optional predicate. Pure callbag — no Store dependency.

For Store objects (which need a `.get()` fast path), use `extra/firstValueFrom`.

This is the canonical callbag → Promise bridge. Business logic should
use this instead of `new Promise`.

## Signature

```ts
function firstValueFrom<T>(
	source: CallbagSource,
	opts?: { predicate?: (value: T) => boolean; signal?: AbortSignal },
): Promise<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `CallbagSource` | A raw callbag source function. |
| `opts` | `{ predicate?: (value: T) =&gt; boolean; signal?: AbortSignal }` | Optional predicate filter and/or AbortSignal for cancellation. |

## Returns

Promise that resolves with the matching value, or rejects if
the source completes (END) without a match or the signal is aborted.

## Options / Behavior Details

- If the source never emits and no `signal` is provided, the returned
Promise never settles and the subscription is never cleaned up. Always pass
`signal` when subscribing to potentially non-completing sources.
