# distinctUntilChanged()

Drops consecutive duplicates; optional `eq` replaces default `Object.is` (Tier 1).

## Signature

```ts
function distinctUntilChanged<A>(eq?: (a: A, b: A) => boolean): StoreOperator<A, A>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `eq` | `(a: A, b: A) =&gt; boolean` | Equality for consecutive pair comparison. |

## Returns

`StoreOperator&lt;A, A&gt;`

## See Also

- [filter](/api/filter)
