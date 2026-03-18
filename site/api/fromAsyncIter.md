# fromAsyncIter()

Pulls async values from an `AsyncIterable` or `() =&gt; AsyncIterable` (factory for retry/repeat) (Tier 2).

## Signature

```ts
function fromAsyncIter<T>(
	iterableOrFactory: AsyncIterable<T> | (() => AsyncIterable<T>),
): ProducerStore<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `iterableOrFactory` | `AsyncIterable&lt;T&gt; | (() =&gt; AsyncIterable&lt;T&gt;)` | Single-use iterable or factory for fresh iterators per subscribe. |

## Returns

`ProducerStore&lt;T&gt;` — aborts iteration when last sink disconnects.

## Options / Behavior Details

- **Factory:** Prefer `() => gen()` for resubscribable sources.
