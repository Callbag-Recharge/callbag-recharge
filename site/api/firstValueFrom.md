# firstValueFrom()

Subscribes to a store and resolves with the first value matching the
optional predicate. Checks the current value immediately before waiting.

This is the canonical callbag → Promise bridge. Business logic should
use this instead of `new Promise`.

## Signature

```ts
function firstValueFrom<T>(store: Store<T>, predicate?: (value: T) => boolean): Promise<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `store` | `Store&lt;T&gt;` | The store to observe. |
| `predicate` | `(value: T) =&gt; boolean` | Optional filter. If omitted, resolves with the first emission. |

## Returns

Promise that resolves with the matching value, or rejects if
the source completes (END) without a match.
