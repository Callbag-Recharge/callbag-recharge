# Optimizations

callbag-recharge deliberately trades some performance for simplicity and correctness. This document describes built-in optimization APIs and techniques for performance-sensitive paths.

---

## Built-in optimizations

These are shipped in the library and ready to use.

### 1. `Inspector.enabled` — skip registration in production

Every store calls `Inspector.register()` on creation (WeakRef + WeakMap). Disabling the Inspector eliminates this overhead entirely.

```ts
import { Inspector } from 'callbag-recharge'

// At app startup / in your production entry point:
Inspector.enabled = false
```

- `register()` becomes a no-op — no WeakRef, no WeakMap writes
- `getName()` returns `undefined` — pipe operator names are skipped
- `graph()` returns an empty Map
- **6.8x faster** store creation (see [benchmarks](./benchmarks.md#inspector-disabled-vs-enabled-store-creation))

The flag defaults to `true` when `NODE_ENV !== 'production'` and `true` in browsers. Set it explicitly for deterministic behavior.

### 2. `equals` option — custom equality on state, derived, and stream

By default, stores use `Object.is` for equality. The `equals` option lets you provide a custom comparison to skip unnecessary DIRTY propagation or cache derived outputs.

**On `state()` — skip DIRTY when values are structurally equal:**

```ts
const user = state(
  { id: 1, name: 'Alice' },
  { equals: (a, b) => a.id === b.id }
)

user.set({ id: 1, name: 'Bob' }) // same id → no DIRTY, no effect re-runs
user.set({ id: 2, name: 'Carol' }) // different id → propagates
```

**On `derived()` — pull-phase caching:**

```ts
const category = derived(
  [score],
  () => (score.get() >= 90 ? 'A' : score.get() >= 80 ? 'B' : 'C'),
  { equals: (a, b) => a === b }
)
```

When `equals` is provided, `derived` stores cache their last output. If the recomputed value equals the cached one, the cached reference is returned. This is especially useful for derived stores that clamp, round, or categorize — their output changes less often than their inputs.

**On `stream()` — skip emit for equal values:**

```ts
const position = stream<{ x: number; y: number }>(
  (emit) => { /* high-frequency emitter */ },
  { equals: (a, b) => a.x === b.x && a.y === b.y }
)
```

**When to use:** Object/array state, derived stores whose output stabilizes (enums, categories, rounded values), or high-frequency streams where many consecutive emissions are equal.

### 3. `batch()` — coalesce multiple state changes

Each `.set()` call triggers its own DIRTY propagation and effect flush. `batch()` defers all effect execution until the outermost batch completes.

```ts
import { batch } from 'callbag-recharge'

batch(() => {
  a.set(1)
  b.set(2)
  c.set(3)
}) // effects run once, not three times
```

- Nesting is supported — effects flush only when the outermost batch ends
- Return values are forwarded: `const result = batch(() => computeAndSet())`
- Errors in the callback still correctly restore batch depth (try/finally)
- **3.3x faster** for 10 concurrent set() calls with an active effect

**When to use:** Any code path that updates multiple state stores and has active effects or subscribers downstream.

### 4. `pipeRaw()` — fused pipe with a single derived store

`pipe()` creates one `derived` store per operator (each with its own Inspector registration and sinks Set). `pipeRaw()` fuses all transform functions into a single `derived` store.

```ts
import { pipeRaw, SKIP } from 'callbag-recharge'

const result = pipeRaw(
  source,
  (n: number) => n * 2,
  (n: number) => n > 0 ? n : SKIP,  // SKIP = filter semantics
  (n: number) => n + 1,
)

result.get() // runs all 3 transforms in one derived() call
```

- `SKIP` sentinel replaces filter — returns the last non-skipped value (or `undefined` if nothing has passed yet)
- Type overloads for up to 4 transforms
- No `scan` support (use regular `pipe()` with the `scan` operator for accumulator state)

**When to use:** Performance-sensitive pipe chains where you don't need per-step inspectability or `scan`, or when you need `SKIP` filter semantics.

### 5. Raw callbag interop for hot paths

Every store's `.source` property is a standard callbag source. For maximum throughput on streaming hot paths, use raw callbag operators directly:

```ts
import cbPipe from 'callbag-pipe'
import cbMap from 'callbag-map'
import cbFilter from 'callbag-filter'
import cbSubscribe from 'callbag-subscribe'

cbPipe(
  store.source,
  cbMap(n => n * 2),
  cbFilter(n => n > 0),
  cbSubscribe(v => { /* ... */ }),
)
```

Raw callbag operators are nested function calls with zero allocation — **~2x faster** than recharge pipes. The tradeoff is no `.get()`, no Inspector visibility, and no store interop (pure push, no pull).

### 6. Memoized derived stores (userland)

For derived stores with expensive computation functions, memoize at the call site:

```ts
let lastA: number, lastB: number, lastResult: number
const memoized = derived([inputA, inputB], () => {
  const a = inputA.get()
  const b = inputB.get()
  if (a === lastA && b === lastB) return lastResult
  lastA = a; lastB = b
  return (lastResult = heavyComputation(a, b))
})
```

This is more general than `equals` — it compares *inputs* rather than *outputs*. Use this when the computation itself is expensive (>1ms) and inputs change less often than DIRTY propagates.

---

## Potential future optimizations

These are not yet implemented but represent opportunities for further improvement.

### Selective subscription (fine-grained reactivity)

Currently, any change to a state store notifies all downstream derived stores, even if the specific property they depend on didn't change:

```ts
const user = state({ name: 'Alice', age: 30 })
const name = derived([user], () => user.get().name) // re-runs on ANY user change
```

Two approaches:

**Approach A — Split into granular stores:**

```ts
const name = state('Alice')
const age = state(30)
const nameUpper = derived([name], () => name.get().toUpperCase()) // only re-runs on name change
```

**Approach B — Selector-based derived:**

```ts
// Hypothetical API
const name = select(user, u => u.name) // only propagates DIRTY when .name changes
```

This would require derived stores to compare their output value with the previous one before propagating DIRTY downstream — a form of memoization at the output rather than the input. The `equals` option on derived already provides the pull-phase half of this; the missing piece is suppressing DIRTY propagation to downstream sinks.

### Compile-time Inspector removal

A Babel/SWC plugin or separate entry point (`callbag-recharge/slim`) that removes all Inspector calls at build time, saving ~1 KB from the bundle and guaranteeing zero per-store overhead without runtime flag checks.

---

## Summary

| Optimization | Status | Impact | When to use |
|---|---|---|---|
| `Inspector.enabled = false` | Built-in | 6.8x faster store creation | Production builds |
| `equals` on state/derived/stream | Built-in | Skip unnecessary DIRTY / cache outputs | Object/array state, stabilizing derived |
| `batch()` | Built-in | 3.3x for multi-set patterns | Concurrent state updates |
| `pipeRaw()` + `SKIP` | Built-in | Single derived store for pipe chain | Hot pipe chains, SKIP filter semantics |
| Raw callbag interop | Built-in | ~2x for pure streaming | Hot paths, no store needed |
| Memoized derived (userland) | Userland pattern | Skip expensive recomputation | Heavy computation functions |
| Selective subscription | Potential | Fine-grained reactivity | Large object stores |
| Compile-time Inspector removal | Potential | Zero overhead + smaller bundle | Production builds |
