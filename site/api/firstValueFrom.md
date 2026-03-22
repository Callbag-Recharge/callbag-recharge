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
	predicate?: (value: T) => boolean,
): Promise<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `CallbagSource` | A raw callbag source function. |
| `predicate` | `(value: T) =&gt; boolean` | Optional filter. If omitted, resolves with the first emission. |

## Returns

Promise that resolves with the matching value, or rejects if
the source completes (END) without a match.
