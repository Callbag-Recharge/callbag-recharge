# useSubscribeRecord() (React)

Subscribe to a dynamic set of keyed store records in React.

When `keys` changes, old per-key subscriptions are torn down and rebuilt.

## Signature

```ts
function useSubscribeRecord<K extends string, R extends Record<string, any>>(
  keys: Store<K[]>,
  factory: StoreFactory<K, R>,
): Record<K, R>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `keys` | `Store&lt;K[]&gt;` | Store of current keys (for example node IDs). |
| `factory` | `StoreFactory&lt;K, R&gt;` | Returns a `{ [field]: Store&lt;V&gt; }` object for each key. |

## Returns

`Record&lt;K, R&gt;` - keyed snapshot of resolved values.

## Basic Usage

```tsx
const nodeIds = state(["extract", "transform"]);
const data = useSubscribeRecord(nodeIds, (id) => ({
  status: statusById[id],
  breaker: breakerById[id],
}));
```

## See Also

- Generic overview: `/api/useSubscribeRecord`
- `useSubscribe()` (React): `/api/useSubscribeReact`
