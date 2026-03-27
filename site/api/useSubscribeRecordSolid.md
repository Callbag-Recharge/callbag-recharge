# useSubscribeRecord() (Solid)

Subscribe to a dynamic set of keyed store records as a Solid accessor.

When `keys` changes, old per-key subscriptions are torn down and rebuilt.

## Signature

```ts
function useSubscribeRecord<K extends string, R extends Record<string, any>>(
  keys: Store<K[]>,
  factory: StoreFactory<K, R>,
): Accessor<Record<K, R>>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `keys` | `Store&lt;K[]&gt;` | Store of current keys (for example node IDs). |
| `factory` | `StoreFactory&lt;K, R&gt;` | Returns a `{ [field]: Store&lt;V&gt; }` object for each key. |

## Returns

`Accessor&lt;Record&lt;K, R&gt;&gt;` - accessor for keyed snapshot.

## Basic Usage

```tsx
const nodeData = useSubscribeRecord(nodeIds, (id) => ({
  status: statusById[id],
  breaker: breakerById[id],
}));
```

## See Also

- Generic overview: `/api/useSubscribeRecord`
- `useSubscribe()` (Solid): `/api/useSubscribeSolid`
