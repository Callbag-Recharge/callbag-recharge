# withStatus()

Wraps a `Store&lt;T&gt;` in a producer with `status` and `error` companion stores.

## Signature

```ts
function withStatus<T>(store: Store<T>, opts?: WithStatusOptions): WithStatusStore<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `store` | `Store&lt;T&gt;` | The source store to wrap. |
| `opts` | `WithStatusOptions` | Optional configuration. |

## Returns

`WithStatusStore&lt;T&gt;` — a new store with `status` and `error` companions. Single upstream subscription with proper teardown.

## Basic Usage

```ts
import { producer, subscribe } from 'callbag-recharge';
import { withStatus } from 'callbag-recharge/utils';

const raw = producer<number>(({ emit }) => {
    setTimeout(() => emit(42), 100);
  });
const tracked = withStatus(raw);
subscribe(tracked.status, s => console.log(s)); // "active" after 100ms
subscribe(tracked, v => console.log(v));         // 42
```

## Options / Behavior Details

- **Lifecycle-aware:** Subscribes upstream inside a `producer()`, so teardown cleans up when all downstream sinks disconnect.
- **Companions are stores:** `store.status` and `store.error` are plain `Store<T>`, subscribable with any sink or framework binding.
- **Lifecycle:** `pending` (no data yet) → `active` (first DATA received) → `completed` (END) or `errored` (END with error).
- **For async sources:** `subscribe()` does not emit initial values (Rx semantics), so `state()` stores stay "pending" until `.set()` is called. Use `{ initialStatus: "active" }` for pre-populated stores.
