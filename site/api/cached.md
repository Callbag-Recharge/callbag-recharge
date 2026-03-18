# cached()

**Factory:** `cached(deps, fn)` — like `derived` but skips `fn()` on disconnected `get()` when dep snapshots match.
**Pipe:** `cached(eq?)` — output dedup + cached pull (similar to `distinctUntilChanged` + getter cache).

## Signature

```ts
function cached<T>(deps: Store<unknown>[], fn: () => T, opts?: StoreOptions<T>): Store<T>
function cached<A>(eq?: (a: A, b: A) => boolean): StoreOperator<A, A>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `args` | `any[]` |  |

## Returns

`Store&lt;T&gt;` or `StoreOperator&lt;A, A&gt;` depending on overload.

## See Also

- [derived](/api/derived)
- [distinctUntilChanged](/api/distinctUntilChanged)
