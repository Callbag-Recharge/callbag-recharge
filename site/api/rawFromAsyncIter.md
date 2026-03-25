# rawFromAsyncIter()

Converts an `AsyncIterable&lt;T&gt;` (or factory) into a raw callbag source.
Emits each yielded value as DATA, then END on completion.

Factory form `() =&gt; AsyncIterable&lt;T&gt;` creates a fresh iterator per
subscriber — use for resubscribable sources.

## Signature

```ts
function rawFromAsyncIter<T>(
	iterableOrFactory: AsyncIterable<T> | (() => AsyncIterable<T>),
): CallbagSource
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `iterableOrFactory` | `AsyncIterable&lt;T&gt; | (() =&gt; AsyncIterable&lt;T&gt;)` | Single-use iterable or factory for fresh iterators. |

## Returns

A raw callbag source function.
