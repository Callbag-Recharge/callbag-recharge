# producer()

Creates a general-purpose reactive source with `emit`, `signal`, `complete`, and `error`.
The optional factory runs on first subscriber; its return value is cleanup on last disconnect.

## Signature

```ts
function producer<T>(
	fn: ProducerFn<T> | undefined,
	opts: ProducerOpts<T> & { initial: T },
): ProducerStore<T> & Store<T>
function producer<T>(fn?: ProducerFn<T>, opts?: ProducerOpts<T>): ProducerStore<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `fn` | `ProducerFn&lt;T&gt;` | Optional setup function receiving action callbacks; return teardown on disconnect. |
| `opts` | `ProducerOpts&lt;T&gt;` | Optional configuration (initial value, equality, autoDirty, getter, etc.). |

### ProducerOpts

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `initial` | `T` | `undefined` | Value before first emit; reset target when `resetOnTeardown`. |
| `equals` | `(a: T, b: T) =&gt; boolean` | `undefined` | Skips emit when new value equals cached. |
| `autoDirty` | `boolean` | `true` | Send DIRTY on STATE before each DATA emission. |
| `getter` | `(cached) =&gt; T` | `undefined` | Pull-based recompute when disconnected. |
| `resetOnTeardown` | `boolean` | `false` | Reset to `initial` when last sink disconnects. |
| `resubscribable` | `boolean` | `false` | Allow new subscriptions after complete/error. |
| `name` | `string` | `undefined` | Debug name for Inspector. |

## Returns

`ProducerStore&lt;T&gt;` — a store with:

| Method | Signature | Description |
|--------|-----------|-------------|
| `get()` | `() =&gt; T \` | undefined |
| `emit(value)` | `(value: T) =&gt; void` | Pushes a new value to subscribers. |
| `signal(s)` | `(s: Signal) =&gt; void` | Sends DIRTY or RESOLVED on the STATE channel. |
| `complete()` | `() =&gt; void` | Ends the stream successfully. |
| `error(e)` | `(e: unknown) =&gt; void` | Ends the stream with an error. |
| `source` | `callbag` | Underlying callbag source for subscriptions. |

## Basic Usage

```ts
import { producer } from 'callbag-recharge';

const bus = producer<string>();
bus.emit('a');
bus.get(); // 'a'
```

## Options / Behavior Details

- **Lazy start:** No work until the first `source()` subscription.
- **Tier 2 boundary:** Used by async/timer operators; each `emit` starts a new DIRTY+value cycle when `autoDirty` is true.

## Examples

### Factory with cleanup

```ts
const ticks = producer<number>(({ emit, complete }) => {
    let n = 0;
    const id = setInterval(() => {
        emit(n++);
        if (n >= 3) complete();
      }, 10);
  return () => clearInterval(id);
});
```

## See Also

- [state](./state) — writable store
- [operator](./operator) — transform primitive
- [effect](./effect) — side-effects
