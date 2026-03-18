# state()

Creates a writable reactive store with an initial value and optional equality check.

## Signature

```ts
function state<T>(initial: T, opts?: StoreOptions<T>): WritableStore<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `initial` | `T` | The initial value of the store. |
| `opts` | `StoreOptions&lt;T&gt;` | Optional configuration. |

### StoreOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | `undefined` | Debug name for Inspector. |
| `equals` | `(a: T, b: T) =&gt; boolean` | `Object.is` | Equality function to prevent redundant emissions. |

## Returns

`WritableStore&lt;T&gt;` — a store with the following API:

| Method | Signature | Description |
|--------|-----------|-------------|
| `get()` | `() =&gt; T` | Returns the current value. |
| `set(value)` | `(value: T) =&gt; void` | Sets a new value and notifies subscribers. |
| `update(fn)` | `(fn: (current: T) =&gt; T) =&gt; void` | Updates the value using a function of the current value. |
| `source` | `callbag` | The underlying callbag source for subscriptions. |

## Basic Usage

```ts
import { state } from 'callbag-recharge';

const count = state(0);

count.get(); // 0
count.set(1);
count.get(); // 1
```

## Options / Behavior Details

- **Equality guard:** `equals` defaults to `Object.is`. If `set()` is called with a value equal to the current value, the emission is skipped entirely.
- **Post-completion no-op:** `set()` is a no-op after `complete()` or `error()`. Both the value update and the emission are skipped. This differs from TC39 Signals, where `Signal.State` has no completion concept.
- **Batching:** Within `batch()`, DIRTY signals propagate immediately but DATA emission is deferred until the outermost batch ends. Multiple `set()` calls in a batch coalesce to only the latest value.
- **Pre-bound `set`:** The `set` method is bound at construction, so it is safe to destructure: `const { set } = myState`.

## Examples

### Update with a function

```ts
const count = state(0);
count.update(n => n + 1);
count.get(); // 1
```

### Custom equals for objects

```ts
const pos = state(
  { x: 0, y: 0 },
  { equals: (a, b) => a.x === b.x && a.y === b.y }
);

pos.set({ x: 0, y: 0 }); // no emission — values are equal
```

### Batching multiple sets

```ts
import { state, derived, batch } from 'callbag-recharge';

const a = state(1);
const b = state(2);
const sum = derived([a, b], () => a.get() + b.get());

batch(() => {
    a.set(10);
    b.set(20);
  });
// sum recomputes only once, after the batch completes
sum.get(); // 30
```

## See Also

- [derived](./derived) — computed stores from dependencies
- [effect](./effect) — side-effects on store changes
- [producer](./producer) — general-purpose push source
- [batch](./batch) — atomic multi-store updates
