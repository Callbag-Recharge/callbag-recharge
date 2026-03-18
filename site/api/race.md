# race()

Mirrors the first source that emits a value; unsubscribes from the losers and follows the winner thereafter.

## Signature

```ts
function race<T>(...sources: Store<T>[]): Store<T | undefined>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `sources` | `Store&lt;T&gt;[]` | Competing `Store&lt;T&gt;` inputs (fair start via deferred wiring). |

## Returns

`Store&lt;T | undefined&gt;` — Tier 2.

## Options / Behavior Details

- **Empty:** Completes immediately if `sources` is empty.
- **Errors:** If a source errors before any DATA, the error propagates.

## See Also

- [merge](/api/merge)
