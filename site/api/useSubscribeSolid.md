# useSubscribe() (Solid)

Subscribe to a callbag-recharge `Store<T>` as a Solid accessor function.

Returns an accessor (`() => T`) that tracks store updates and auto-cleans up
inside a Solid reactive owner.

## Signature

```ts
function useSubscribe<T>(store: Store<T>): Accessor<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `store` | `Store&lt;T&gt;` | Any store, including companion stores such as `status` or `error`. |

## Returns

`Accessor&lt;T&gt;` - Solid accessor function for the current store value.

## Basic Usage

```tsx
import { useSubscribe } from "callbag-recharge/compat/solid";

function StatusBadge(props: { ws: { status: any } }) {
  const status = useSubscribe(props.ws.status);
  return <span>{status()}</span>;
}
```

## See Also

- Svelte helper: `/api/useSubscribeSvelte`
- `useSubscribeRecord()` (Solid): `/api/useSubscribeRecordSolid`
