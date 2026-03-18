# fromIter()

Emits all elements of a synchronous iterable then completes (Tier 2).

## Signature

```ts
function fromIter<T>(iterable: Iterable<T>): ProducerStore<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `iterable` | `Iterable&lt;T&gt;` | Values to push on subscribe. |

## Returns

`ProducerStore&lt;T&gt;`
