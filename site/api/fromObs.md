# fromObs()

Bridges a minimal Observable shape (`subscribe({ next, error, complete })`) into a store (Tier 2).

## Signature

```ts
function fromObs<T>(observable: Observable<T>): ProducerStore<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `observable` | `Observable&lt;T&gt;` | Any object with that subscribe API (e.g. RxJS Observable). |

## Returns

`ProducerStore&lt;T&gt;`
