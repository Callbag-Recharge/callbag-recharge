# producer()

Creates a general-purpose push-based source with lifecycle management.

## Signature

```ts
function producer<T>(
  fn?: ProducerFn<T>,
  opts?: ProducerOpts<T>
): ProducerStore<T>

function producer<T>(
  fn: ProducerFn<T> | undefined,
  opts: ProducerOpts<T> & { initial: T }
): ProducerStore<T> & Store<T>
```

### ProducerFn

```ts
type ProducerFn<T> = (actions: {
  emit: (value: T) => void;
  signal: (s: Signal) => void;
  complete: () => void;
  error: (e: unknown) => void;
}) => (() => void) | undefined
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `ProducerFn<T>` | Optional factory function. Runs on first subscriber, return value is cleanup. |
| `opts` | `ProducerOpts<T>` | Optional configuration. |

### ProducerOpts

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | `undefined` | Debug name for Inspector. |
| `initial` | `T` | `undefined` | Baseline value before first emission. When provided, `get()` returns `T` instead of `T \| undefined`. |
| `equals` | `(a: T, b: T) => boolean` | `undefined` | Emission guard. Skips emit when values are equal. |
| `autoDirty` | `boolean` | `true` | Sends DIRTY signal on type 3 before each DATA emission. |
| `resetOnTeardown` | `boolean` | `false` | Reset value to `initial` when last subscriber disconnects. |
| `resubscribable` | `boolean` | `false` | Allow re-subscription after complete/error. Re-subscribing restarts the factory. |
| `getter` | `(cached: T \| undefined) => T` | `undefined` | Pull-based `get()` when disconnected. Result is cached. |
| `kind` | `string` | `"producer"` | Inspector kind override. |

## Returns

`ProducerStore<T>` — a store with the following API:

| Method | Signature | Description |
|--------|-----------|-------------|
| `get()` | `() => T \| undefined` | Returns the current value (or calls `getter` if disconnected). |
| `emit(value)` | `(value: T) => void` | Sets value and pushes DATA to subscribers. |
| `signal(s)` | `(s: Signal) => void` | Pushes a control signal (DIRTY/RESOLVED) on the STATE channel. |
| `complete()` | `() => void` | Sends END to all subscribers, marks completed. |
| `error(e)` | `(e: unknown) => void` | Sends END with error to all subscribers, marks errored. |
| `source` | callbag | The underlying callbag source for subscriptions. |

When `opts.initial` is provided, `get()` returns `T` (not `T | undefined`).

## Basic Usage

```ts
import { producer } from 'callbag-recharge';

const ticker = producer(({ emit, complete }) => {
  let i = 0;
  const id = setInterval(() => {
    emit(i++);
    if (i >= 5) complete();
  }, 1000);

  return () => clearInterval(id);
});
```

## Options / Behavior Details

- **Lazy start:** The factory function runs only when the first subscriber connects. Cleanup runs when the last subscriber disconnects.
- **Pre-bound methods:** `emit`, `signal`, `complete`, and `error` are bound at construction, safe to destructure.
- **Post-completion no-op:** After `complete()` or `error()`, all methods (`emit`, `signal`, `complete`, `error`) are no-ops.
- **Resubscribable:** With `resubscribable: true`, subscribing after completion clears the completed flag and re-runs the factory. Used internally by `retry`, `rescue`, and `repeat`.
- **autoDirty:** When `true` (default), each `emit()` sends a DIRTY signal on the STATE channel before the DATA value. This integrates the producer into the two-phase push protocol for diamond resolution.

## Examples

### WebSocket wrapper

```ts
const messages = producer<string>(({ emit, error, complete }) => {
  const ws = new WebSocket('wss://example.com/feed');
  ws.onmessage = (e) => emit(e.data);
  ws.onerror = (e) => error(e);
  ws.onclose = () => complete();

  return () => ws.close();
}, { name: 'ws-messages' });
```

### Manual emit without factory

```ts
const bus = producer<string>();
bus.emit('hello');
bus.get(); // 'hello'
bus.emit('world');
bus.get(); // 'world'
```

### With initial value and resetOnTeardown

```ts
const status = producer<string>(({ emit }) => {
  emit('connected');
  return () => {};
}, {
  initial: 'idle',
  resetOnTeardown: true,
});

status.get(); // 'idle' (before any subscriber)
// After subscriber connects: 'connected'
// After last subscriber disconnects: 'idle' (reset)
```

## See Also

- [state](./state) — thin wrapper for writable stores
- [operator](./operator) — transform primitive
- [fromEvent, fromPromise](https://github.com/anthropics/callbag-recharge/tree/main/src/extra/) — built on producer
