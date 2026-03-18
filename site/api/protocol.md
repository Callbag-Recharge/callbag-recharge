# Protocol & interop

Low-level callbag constants and helpers exported from the main package for advanced use, testing, and custom operators.

## Callbag type constants

```ts
import { START, DATA, END, STATE } from 'callbag-recharge';
```

| Constant | Value | Meaning |
|----------|-------|---------|
| `START` | `0` | Handshake; payload is talkback |
| `DATA` | `1` | Value emissions only (no sentinels) |
| `END` | `2` | Completion or error (error payload) |
| `STATE` | `3` | Control channel (`DIRTY`, `RESOLVED`, …) |

## Control signals

```ts
import { DIRTY, RESOLVED } from 'callbag-recharge';
```

- **`DIRTY`** — “My value is about to change.” Phase 1 of the two-phase push.
- **`RESOLVED`** — “I was dirty but the value did not change.” Downstream can skip recomputation.

Unknown **STATE** payloads are forwarded for forward compatibility.

## Connection batching

When wiring many subscribers at once, producer factories can be deferred so all sinks attach before any source starts:

```ts
import { beginDeferredStart, endDeferredStart } from 'callbag-recharge';

beginDeferredStart();
try {
  // subscribe multiple stores / effects...
} finally {
  endDeferredStart();
}
```

- **`deferStart(fn)`** — If inside `beginDeferredStart`…`endDeferredStart`, queues `fn`; otherwise runs immediately. Used internally when a `source()` subscription triggers upstream start.

## `deferEmission`

Queues a callback to run when the current **batch** drain runs (same mechanism as `batch()`). Primarily for internal primitives; library authors extending the graph may use it with care.

## `teardown(store)`

Force-completes a store-compatible node and propagates **END** through downstream subscribers.

```ts
import { state, teardown } from 'callbag-recharge';

const s = state(0);
// ... subscriptions ...
teardown(s);
// Node is terminal; typical stores stop accepting new writes after complete.
```

Works with nodes that expose `complete()` (producer, state, operator) or internal `_handleEnd` (derived).

## `NodeStatus`

String lifecycle status on nodes (e.g. for `Inspector.inspect`):

`DISCONNECTED` | `DIRTY` | `SETTLED` | `RESOLVED` | `COMPLETED` | `ERRORED`

## See also

- [batch](./batch) — defer DATA while preserving DIRTY ordering
- [operator](./operator) — must forward STATE and emit RESOLVED when filtering
- [Architecture](/architecture/) — full protocol narrative
