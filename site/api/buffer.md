# buffer()

Collects upstream values into arrays, flushing each buffer when `notifier` emits (Tier 2).

## Signature

```ts
function buffer<A>(notifier: Store<unknown>): StoreOperator<A, A[]>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `notifier` | `Store&lt;unknown&gt;` | Any store whose emissions trigger a flush. |

## Returns

`StoreOperator&lt;A, A[]&gt;` — `get()` returns last flushed array (empty before first flush).

## Options / Behavior Details

- **End:** Upstream or notifier completion flushes remaining items when applicable.

## See Also

- [bufferCount](/api/bufferCount)
- [bufferTime](/api/bufferTime)
