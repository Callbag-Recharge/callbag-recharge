# flat()

Flattens `Store&lt;Store&lt;T&gt;&gt;` with switch semantics (same as `switchMap(identity)`).

## Signature

```ts
function flat<T>(): StoreOperator<Store<T> | undefined, T | undefined>
function flat<T>(opts: { initial: T }): StoreOperator<Store<T> | undefined, T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `{
	initial?: T;
}` | Optional `{ initial: T }` to narrow `get()` before the first inner emission. |

## Returns

`StoreOperator` — Tier 2; reactive inner subscription on outer DATA only.

## See Also

- [switchMap](/api/switchMap)
