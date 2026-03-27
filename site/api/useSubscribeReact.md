# useSubscribe() (React)

Subscribe to any callbag-recharge `Store<T>` from React using `useSyncExternalStore`.

Returns the current value and re-renders when the store emits.

## Signature

```ts
function useSubscribe<T>(store: Store<T>): T
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `store` | `Store&lt;T&gt;` | Any store, including companion stores such as `status` or `error`. |

## Returns

`T` - the current store value, kept in sync with React render updates.

## Basic Usage

```tsx
import { useSubscribe } from "callbag-recharge/compat/react";

function StatusBadge({ ws }: { ws: { status: any } }) {
  const status = useSubscribe(ws.status);
  return <span>{status}</span>;
}
```

## See Also

- `useStore()` (React): `/api/useStoreReact`
- `useSubscribeRecord()` (React): `/api/useSubscribeRecordReact`
