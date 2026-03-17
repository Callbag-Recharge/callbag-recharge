# effect()

Runs a side-effect when dependencies change, with optional cleanup.

## Signature

```ts
function effect(
  deps: Store<unknown>[],
  fn: () => undefined | (() => void)
): () => void
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deps` | `Store<unknown>[]` | Array of upstream stores to observe. |
| `fn` | `() => undefined \| (() => void)` | Side-effect function. May return a cleanup function. |

## Returns

`() => void` — a dispose function that stops the effect and runs any pending cleanup.

## Basic Usage

```ts
import { state, effect } from 'callbag-recharge';

const count = state(0);

const dispose = effect([count], () => {
  console.log('count is', count.get());
});
// Logs immediately: "count is 0"

count.set(1);
// Logs: "count is 1"

dispose(); // stops observing
```

## Options / Behavior Details

- **Immediate execution:** `fn()` runs once immediately at creation with the current dependency values.
- **Re-execution:** `fn()` re-runs whenever any dependency emits a new value. Multi-dep effects use dirty tracking and wait for all dirty deps to resolve before running (same diamond resolution as `derived`).
- **Cleanup function:** If `fn` returns a function, it is called before each re-execution and when the effect is disposed. Use this for teardown logic (removing event listeners, clearing timers, etc.).
- **RESOLVED skipping:** When all deps send RESOLVED (no actual value change), the effect skips execution.
- **Auto-dispose on completion:** If any dependency completes or errors, the effect disposes itself automatically.
- **Pure closure implementation:** Effect is implemented as a closure, not a class. No `get()` or `source` — it is a sink, not a store.

## Examples

### Effect with cleanup

```ts
const url = state('/api/data');

const dispose = effect([url], () => {
  const controller = new AbortController();

  fetch(url.get(), { signal: controller.signal })
    .then(r => r.json())
    .then(data => console.log(data));

  return () => controller.abort();
});

url.set('/api/other'); // aborts previous fetch, starts new one
```

### Dispose pattern

```ts
const visible = state(true);

const dispose = effect([visible], () => {
  if (visible.get()) {
    const id = setInterval(() => console.log('tick'), 1000);
    return () => clearInterval(id);
  }
});

// Later, tear down manually:
dispose();
```

### Multi-dep effect with diamond resolution

```ts
const a = state(1);
const b = state(2);
const sum = derived([a, b], () => a.get() + b.get());

effect([sum], () => {
  console.log('sum:', sum.get());
});
// Logs: "sum: 3"

batch(() => {
  a.set(10);
  b.set(20);
});
// Logs once: "sum: 30"
```

## See Also

- [state](./state) — writable reactive store
- [derived](./derived) — computed stores
- [subscribe](https://github.com/anthropics/callbag-recharge/tree/main/src/extra/subscribe.ts) (extra) — callbag sink alternative
