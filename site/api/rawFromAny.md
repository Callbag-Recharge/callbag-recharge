# rawFromAny()

Normalizes any value into a raw callbag source that emits value(s) then completes.

Dispatch order:
1. **PromiseLike** — delegates to `rawFromPromise`
2. **AsyncIterable** — delegates to `rawFromAsyncIter`
3. **Iterable** (non-string) — emits each element synchronously, then END
4. **Plain value** — emits once, then END

## Signature

```ts
function rawFromAny<T>(
	input: T | PromiseLike<T> | Iterable<T> | AsyncIterable<T>,
): CallbagSource
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `input` | `T | PromiseLike&lt;T&gt; | Iterable&lt;T&gt; | AsyncIterable&lt;T&gt;` | Any value, promise, iterable, or async iterable. |

## Returns

A raw callbag source function.
