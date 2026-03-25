# fromPromise()

Emits the promise's resolved value once then completes; rejections become stream errors (Tier 2).

## Signature

```ts
function fromPromise<T>(promise: Promise<T>): ProducerStore<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `promise` | `Promise&lt;T&gt;` | The promise to adapt. |

## Returns

`ProducerStore&lt;T&gt;`
