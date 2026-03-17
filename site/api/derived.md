# derived()

Creates a cached computed store with explicit dependencies that recomputes when any dependency changes.

## Signature

```ts
function derived<T>(
  deps: Store<unknown>[],
  fn: () => T,
  opts?: StoreOptions<T>
): Store<T>
```

### Identity mode

```ts
derived.from<T>(dep: Store<T>, opts?: StoreOptions<T>): Store<T>
```

Forwards the dependency's value directly, skipping `fn()` on updates.

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deps` | `Store<unknown>[]` | Array of upstream stores to depend on. |
| `fn` | `() => T` | Compute function. Called when dirty deps resolve. Reads dep values via `dep.get()`. |
| `opts` | `StoreOptions<T>` | Optional configuration. |

### StoreOptions

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | `undefined` | Debug name for Inspector. |
| `equals` | `(a: T, b: T) => boolean` | `undefined` | Push-phase memoization. When set, sends RESOLVED instead of DATA if value unchanged. |

## Returns

`Store<T>` — a read-only store with:

| Method | Signature | Description |
|--------|-----------|-------------|
| `get()` | `() => T` | Returns the cached computed value. |
| `source` | callbag | The underlying callbag source for subscriptions. |

## Basic Usage

```ts
import { state, derived } from 'callbag-recharge';

const firstName = state('Jane');
const lastName = state('Doe');
const fullName = derived(
  [firstName, lastName],
  () => `${firstName.get()} ${lastName.get()}`
);

fullName.get(); // 'Jane Doe'
firstName.set('John');
fullName.get(); // 'John Doe'
```

## Options / Behavior Details

- **Lazy STANDALONE mode:** Connection to deps is deferred until the first `get()` or `source()` call. Once connected, deps stay connected even without external subscribers, so `get()` always returns the current cached value.
- **Diamond resolution:** Multi-dep derived nodes track dirty deps via a bitmask. When multiple deps share an ancestor, DIRTY propagates immediately but recomputation waits until all dirty deps have resolved, preventing glitches.
- **Single-dep optimization (P0):** When there is only one dependency, the bitmask is skipped entirely for direct DIRTY/DATA forwarding.
- **Push-phase memoization:** When `equals` is provided and the recomputed value equals the cached value, a RESOLVED signal is sent instead of DATA. This lets downstream nodes skip their own recomputation (subtree skipping).
- **Completion:** Completes when any upstream dependency completes or errors.

## Examples

### Multi-dep diamond resolution

```ts
const base = state(1);
const doubled = derived([base], () => base.get() * 2);
const tripled = derived([base], () => base.get() * 3);
const sum = derived(
  [doubled, tripled],
  () => doubled.get() + tripled.get()
);

base.set(2);
sum.get(); // 10 (4 + 6) — computed once, not twice
```

### Identity mode with derived.from

```ts
const source = state(0);
const mirror = derived.from(source);

source.set(42);
mirror.get(); // 42 — forwarded directly, no compute function called
```

### Push-phase memoization with equals

```ts
const data = state({ x: 1, y: 2 });
const xOnly = derived([data], () => data.get().x, {
  equals: Object.is,
});

// Downstream of xOnly won't recompute when only y changes
data.set({ x: 1, y: 99 });
// xOnly sends RESOLVED — its value (1) didn't change
```

## See Also

- [state](./state) — writable reactive store
- [effect](./effect) — side-effects on store changes
- [pipe](./pipe) — composing operators
