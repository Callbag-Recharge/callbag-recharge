# subject()

Creates a `Subject` — imperative push API plus `get()` / `source()` like any store.

## Signature

```ts
function subject<T>(): Subject<T>
```

## Returns

`Subject&lt;T&gt;` with `next`, `error`, `complete`, batch-aware emissions, and optional dedup when sinks exist.

## Options / Behavior Details

- **Dedup:** `Object.is` guard on `next` applies only while subscribers are connected.
