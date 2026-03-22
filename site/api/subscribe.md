# subscribe()

Subscribes to a store's DATA emissions with previous-value tracking.
Returns a Subscription with `unsubscribe()` and `signal()` for upstream lifecycle control.

## Signature

```ts
function subscribe<T>(
	store: Store<T>,
	cb: (value: T, prev: T | undefined) => void,
	opts?: { onEnd?: (error?: unknown) => void },
): Subscription
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `store` | `Store&lt;T&gt;` | The `Store&lt;T&gt;` to listen to. |
| `cb` | `(value: T, prev: T | undefined) =&gt; void` | Called with `(nextValue, previousValue)` on each DATA after subscribe. |
| `opts` | `{ onEnd?: (error?: unknown) =&gt; void }` | Optional `onEnd` when the stream completes or errors. |

## Returns

`Subscription` — `unsubscribe()` to disconnect, `signal(s)` to send lifecycle signals upstream.

## Basic Usage

```ts
import { state, subscribe, RESET } from 'callbag-recharge';

const n = state(0);
const sub = subscribe(n, (v, prev) => console.log(v));
n.set(1);
sub.signal(RESET);    // send RESET upstream
sub.unsubscribe();    // disconnect
```

## See Also

- [effect](./effect)
- [forEach](/api/forEach) — simpler value-only subscription
