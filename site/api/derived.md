# derived()

Creates a computed store from explicit dependencies with diamond-safe dirty tracking.
Fully lazy: connects when subscribed; `get()` pull-computes when disconnected without wiring upstream.

## Signature

```ts
function derived<T>(deps: Store<unknown>[], fn: () => T, opts?: StoreOptions<T>): Store<T>
```

### derived.from

```ts
derived.from<T>(dep: Store<T>, opts?: StoreOptions<T>): Store<T>
```

Creates a single-dep derived that forwards the dependency’s value (identity mode).
Skips redundant `fn()` work on updates compared to `derived([dep], () => dep.get())`.

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deps` | `Store&lt;unknown&gt;[]` | Stores this derived reads from (order defines dep indices for operators). |
| `fn` | `() =&gt; T` | Pure function returning the derived value; called when deps have settled. |
| `opts` | `StoreOptions&lt;T&gt;` | Optional `name` and `equals` for push-phase memoization (RESOLVED). |

### StoreOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | `undefined` | Debug name for Inspector. |
| `equals` | `(a: T, b: T) =&gt; boolean` | `undefined` | If equal after recompute, skips DATA (sends RESOLVED). |

## Returns

`Store&lt;T&gt;` — read-only store: `get()`, `source()` for subscriptions.

## Basic Usage

```ts
import { state, derived } from 'callbag-recharge';

const a = state(1);
const b = state(2);
const sum = derived([a, b], () => a.get() + b.get());
sum.get(); // 3
```

## Options / Behavior Details

- **Diamond safety:** Waits for all dirty deps to resolve before one recompute.
- **Disconnect on unsub:** When all subscribers leave, disconnects from deps until next subscription.

## Examples

### Identity passthrough

```ts
const x = state(1);
const y = derived.from(x);
y.get(); // 1
```

## See Also

- [state](./state)
- [effect](./effect)
- [pipe](/api/pipe) — operators on stores
