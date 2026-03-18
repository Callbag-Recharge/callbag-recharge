# exhaustMap()

Like `switchMap`, but **ignores** new outer values until the current inner completes.

## Signature

```ts
function exhaustMap<A, B>(fn: (value: A) => Store<B>): StoreOperator<A, B | undefined>
function exhaustMap<A, B>(
	fn: (value: A) => Store<B>,
	opts: { initial: B },
): StoreOperator<A, B>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `(value: A) =&gt; Store&lt;B&gt;` | Inner store factory. |
| `opts` | `{ initial?: B }` | Optional `{ initial: B }`. |

## Returns

`StoreOperator` — Tier 2.

## See Also

- [switchMap](/api/switchMap)
- [concatMap](/api/concatMap)
