# track()

Wraps a stream with observable lifecycle metadata: status, count, duration, error (Tier 2).

## Signature

```ts
function track<A>(opts?: { name?: string }): StoreOperator<A, A>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `{ name?: string }` | Optional configuration. |

## Returns

`StoreOperator&lt;A, A&gt;` — pipe-compatible. The returned store has a `meta` property (`Store&lt;TrackMeta&gt;`).

| Method | Signature | Description |
|--------|-----------|-------------|
| `get()` | `() =&gt; A \` | undefined |
| `meta` | `Store\&lt;TrackMeta\&gt;` | Reactive metadata: status, count, duration, error. |
| `source` | `callbag` | Underlying callbag source for subscriptions. |

## Basic Usage

```ts
import { state, pipe, effect } from 'callbag-recharge';
import { track } from 'callbag-recharge/orchestrate';

const input = state(0);
const tracked = pipe(input, track());
effect([tracked.meta], () => {
    console.log(tracked.meta.get().status); // "idle" → "active"
  });
input.set(1); // meta: { status: "active", count: 1 }
```

## Options / Behavior Details

- **Tier 2:** Cycle boundary — each forwarded value starts a new DIRTY+value cycle.
- **Lifecycle:** idle → active (first value) → completed/errored (upstream END). Resets on reconnect.
- **Duration:** Measured from first value to completion/error.

## See Also

- [gate](./gate) — human-in-the-loop
- [taskState](./taskState) — async function tracking
