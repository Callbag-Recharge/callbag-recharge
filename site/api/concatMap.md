# concatMap()

Maps each outer value to an inner store and runs inners **sequentially** (queue while busy).

## Signature

```ts
function concatMap<A, B>(fn: (value: A) => Store<B>): StoreOperator<A, B | undefined>
function concatMap<A, B>(
	fn: (value: A) => Store<B>,
	opts: { initial: B; maxBuffer?: number },
): StoreOperator<A, B>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `(value: A) =&gt; Store&lt;B&gt;` | Inner store factory. |
| `opts` | `{ initial?: B; maxBuffer?: number }` | `{ initial: B }` narrows type; `maxBuffer` drops oldest queued outers when exceeded (default: unlimited). |

## Returns

`StoreOperator&lt;A, B | undefined&gt;` or `B` with `initial`.

## Options / Behavior Details

- **Tier 2:** Reactive; no eager `fn(outer.get())`.

## See Also

- [switchMap](/api/switchMap)
- [exhaustMap](/api/exhaustMap)
