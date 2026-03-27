# useStore() (React)

Bind a writable callbag-recharge `WritableStore<T>` as a React tuple.

This helper returns `[value, setter]`, where `setter(next)` calls `store.set(next)`.

## Signature

```ts
function useStore<T>(store: WritableStore<T>): [T, (value: T) => void]
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `store` | `WritableStore&lt;T&gt;` | Writable store, typically created by `state()`. |

## Returns

`[T, (value: T) => void]` - current value and setter function.

## Basic Usage

```tsx
import { useStore } from "callbag-recharge/compat/react";

function Counter({ counter }: { counter: any }) {
  const [count, setCount] = useStore(counter);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}
```

## See Also

- `useSubscribe()` (React): `/api/useSubscribeReact`
