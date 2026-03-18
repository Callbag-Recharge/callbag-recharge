# tap()

Runs `fn` for each value then re-emits it unchanged (Tier 1).

## Signature

```ts
function tap<A>(fn: (value: A) => void): StoreOperator<A, A>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `(value: A) =&gt; void` | Observer side effect. |

## Returns

`StoreOperator&lt;A, A&gt;`
