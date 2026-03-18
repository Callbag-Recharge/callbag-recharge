# subscribe()

Subscribes to a store’s DATA emissions with previous-value tracking. Returns an unsubscribe function.
Does not invoke the callback for the current value at subscribe time (Rx-style); only subsequent changes.

## Signature

```ts
function subscribe<T>(
	store: Store<T>,
	cb: (value: T, prev: T | undefined) => void,
	opts?: { onEnd?: (error?: unknown) => void },
): () => void
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `store` | `Store&lt;T&gt;` | The `Store&lt;T&gt;` to listen to. |
| `cb` | `(value: T, prev: T | undefined) =&gt; void` | Called with `(nextValue, previousValue)` on each DATA after subscribe. |
| `opts` | `{ onEnd?: (error?: unknown) =&gt; void }` | Optional `onEnd` when the stream completes or errors. |

## Returns

`() =&gt; void` — call to unsubscribe (sends END on talkback).

## Basic Usage

```ts
import { state, subscribe } from 'callbag-recharge';

const n = state(0);
const stop = subscribe(n, (v, prev) => {
    // prev is undefined on first emission after subscribe
  });
n.set(1);
stop();
```

## Options / Behavior Details

- **Deferred start:** Works with `beginDeferredStart` / `endDeferredStart` batching used internally.

## See Also

- [effect](./effect)
- [forEach](/api/forEach) — simpler value-only subscription
