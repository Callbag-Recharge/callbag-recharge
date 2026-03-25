# rawFromPromise()

Converts a `PromiseLike&lt;T&gt;` into a raw callbag source that emits the
resolved value once then completes. Rejections become END with error.

## Signature

```ts
function rawFromPromise<T>(promise: PromiseLike<T>): CallbagSource
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `promise` | `PromiseLike&lt;T&gt;` | The promise (or thenable) to adapt. |

## Returns

A raw callbag source function.
