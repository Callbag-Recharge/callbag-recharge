# Optimizations

callbag-recharge deliberately trades some performance for simplicity and correctness. This document describes built-in optimization APIs, techniques for performance-sensitive paths, and identified opportunities for further improvement.

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
- **~1.3x faster** store creation (see [benchmarks](./benchmarks.md#inspector-disabled-vs-enabled-store-creation))

The flag defaults to `true` when `NODE_ENV !== 'production'` and `true` in browsers. Set it explicitly for deterministic behavior.

### 2. `equals` option — custom equality on state, derived, and producer

By default, stores use `Object.is` for equality. The `equals` option has different effects depending on the store type.

**On `state()` — skip DIRTY when values are structurally equal:**

```ts
const user = state(
  { id: 1, name: 'Alice' },
  { equals: (a, b) => a.id === b.id }
)

user.set({ id: 1, name: 'Bob' }) // same id → no DIRTY, no effect re-runs
user.set({ id: 2, name: 'Carol' }) // different id → propagates
```

**On `derived()` — push-phase memoization via RESOLVED:**

```ts
const category = derived(
  [score],
  () => (score.get() >= 90 ? 'A' : score.get() >= 80 ? 'B' : 'C'),
  { equals: (a, b) => a === b }
)
```

When `equals` is provided, `derived` stores cache their last output. If the recomputed value equals the cached one, derived sends `RESOLVED` on type 3 instead of emitting the value — downstream nodes that were counting this dep as dirty decrement their pending count without receiving a new value. If ALL of a downstream node's dirty deps sent RESOLVED, that node sends RESOLVED too — **skipping `fn()` entirely**. This is true push-phase memoization: entire subtrees can be skipped when values don't change.

**On `producer()` — skip emit for equal values:**

```ts
const position = producer<{ x: number; y: number }>(
  ({ emit }) => { /* high-frequency emitter */ },
  { equals: (a, b) => a.x === b.x && a.y === b.y }
)
```

**When to use:** `state` — skip DIRTY propagation entirely for equal values. `derived` — push-phase memoization via RESOLVED (skips entire downstream subtrees). `producer` — skip emit for equal values. All types benefit from object/array equality where structural comparison is needed.

### 3. `batch()` — coalesce multiple state changes

Each `.set()` call triggers its own DIRTY propagation and effect flush. `batch()` defers all type 1 DATA emissions until the outermost batch completes, while type 3 DIRTY propagates immediately.

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
- Multiple emits to the same producer coalesce: only the latest value is emitted at drain time
- **1.7x faster** for 10 concurrent set() calls with an active effect

**When to use:** Any code path that updates multiple state stores and has active effects or subscribers downstream.

### 4. `pipeRaw()` — fused pipe with a single derived store

`pipe()` creates one `derived` store per operator (each with its own Inspector registration and sinks Set). `pipeRaw()` fuses all transform functions into a single `derived` store.

```ts
import { pipeRaw, SKIP } from 'callbag-recharge/extra'

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

Raw callbag operators are nested function calls with zero allocation — **~2.5x faster** than recharge pipes. The tradeoff is no `.get()`, no Inspector visibility, and no store interop (pure push, no pull).

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

### 7. Class-based primitives with lazy sinks — reduced memory footprint

All five primitives (`ProducerImpl`, `StateImpl`, `DerivedImpl`, `OperatorImpl`, `EffectImpl`) use classes with prototype method sharing and V8 hidden class optimization. The factory functions (`producer()`, `state()`, `derived()`, `operator()`, `effect()`) are preserved as the public API.

**Results:**
- Memory per store: ~3,600 bytes → ~740 bytes (**4.9x smaller**, ~6x gap vs Preact's ~121 bytes)
- Store creation (Inspector OFF): 405K → 7.6M ops/sec (**18.8x faster**)
- Store creation (Inspector ON): 236K → 1.4M ops/sec (**5.9x faster**)
- Throughput: equal or better across all benchmarks

**Class + prototype methods:** Methods live on the prototype and are shared across all instances. Public API methods (`source`, `emit`, `signal`, `complete`, `error`, `set`) are bound in the constructor so they work when detached (callbag interop, destructuring). `ProducerImpl._start()` passes `this` directly to the user-supplied `fn`, eliminating the actions wrapper object allocation per start. `EffectImpl._run()` on the prototype is inlined by V8 much better than a closure-captured `run()` function — **2x faster** effect re-runs.

**Lazy `_sinks = null`:** All classes initialize `_sinks` as `null`. The Set is allocated on first subscriber connect and nulled when the last subscriber disconnects. Pull-only stores never allocate a Set (~200 bytes saved per pull-only store).

**Remaining gap vs Preact (~6x):** Preact's ~118 bytes/store is achievable only with further work — Preact stores no per-instance bound functions and uses bitfield flags instead of boolean fields. The talkback closure in `source()` and per-connection state remain inherent costs in the callbag protocol.

### 8. `endDeferredStart()` O(n) drain

`endDeferredStart()` uses an index-based `for` loop + `length = 0` (O(n)) instead of `while/shift()` (O(n²)), matching the `batch()` drain pattern. Impact scales with the number of deps in a single `effect()` or `derived()`.

### 9. Integer bitmask for dirty dep tracking

Both `effect()` and `DerivedImpl` use a single `number` bitmask instead of `Set<number>` for dirty dep tracking. Bitwise operations replace Set methods:

- `dirtyDeps |= (1 << depIndex)` — mark dirty (was `set.add()`)
- `dirtyDeps & (1 << depIndex)` — check dirty (was `set.has()`)
- `dirtyDeps &= ~(1 << depIndex)` — resolve (was `set.delete()`)
- `dirtyDeps === 0` — check settled (was `set.size === 0`)

Bitwise ops are ~10x faster than Set operations. Supports up to 32 deps per effect/derived, which covers virtually all real-world cases. Also eliminates the Set allocation (~200 bytes per effect).

### 10. `Inspector.enabled` getter caching

The default `enabled` getter resolves `process.env.NODE_ENV` through a try/catch only once. The result is cached in `_cachedDefault` and returned directly on subsequent calls. `_reset()` clears the cache for test isolation.

---

## Potential optimizations

These are not yet implemented but represent concrete opportunities for improvement, ordered by expected impact.

### 1. Derived `get()` always recomputes when unconnected

**Status:** Not implemented. **Impact:** Medium (pull-only derived stores).

When a derived store has no subscribers (unconnected), every `.get()` call runs `fn()` from scratch:

```ts
get() {
  if (connected && dirtyDeps.size === 0) {
    return cachedValue as T;  // fast path: connected + settled
  }
  // Slow path: always recomputes
  const result = fn();
  ...
}
```

Derived stores that are only used in pull mode (`.get()` without subscribers) recompute on every call even if deps haven't changed. The benchmark shows this is still fast (~138M ops/sec for simple computations), but for expensive `fn()` calls it's wasteful.

**Possible approach:** Always cache the result and track a "generation" counter. Each state `.set()` increments a global generation. Derived checks if its deps' generation changed since last cache; if not, return cache. This adds a cheap integer comparison to `get()` but eliminates redundant `fn()` calls.

### 2. Compile-time Inspector removal

**Status:** Not implemented. **Impact:** Low (bundle size + micro-optimization).

A Babel/SWC plugin or separate entry point (`callbag-recharge/slim`) that removes all Inspector calls at build time, saving ~1 KB from the bundle and guaranteeing zero per-store overhead without runtime flag checks.

---

## Summary

| Optimization | Status | Impact | When to use |
|---|---|---|---|
| `Inspector.enabled = false` | Built-in | ~1.3x faster store creation | Production builds |
| `equals` on state | Built-in | Skip DIRTY propagation entirely | Object/array state |
| `equals` on derived | Built-in | Push-phase memoization via RESOLVED — skips entire downstream subtrees | Stabilizing derived outputs |
| `equals` on producer | Built-in | Skip emit for equal values | High-frequency producers |
| `batch()` | Built-in | 1.7x for multi-set patterns | Concurrent state updates |
| `pipeRaw()` + `SKIP` | Built-in | Single derived store for pipe chain | Hot pipe chains, SKIP filter semantics |
| Raw callbag interop | Built-in | ~2.5x for pure streaming | Hot paths, no store needed |
| Memoized derived (userland) | Userland pattern | Skip expensive recomputation | Heavy computation functions |
| Class + lazy sinks | Built-in | 4.9x memory reduction, 17.5x faster store creation, 2x faster effects | All stores and effects |
| `endDeferredStart()` O(n) drain | Built-in | Faster connection batching | Effects/derived with many deps |
| Integer bitmask dirty tracking | Built-in | ~10x faster dirty ops vs Set, eliminates Set allocation | Effects and derived with ≤32 deps |
| `Inspector.enabled` getter caching | Built-in | Avoid repeated try/catch | Bulk store creation |
| Unconnected derived caching | Potential | Skip redundant `fn()` on pull | Pull-only derived stores |
| Compile-time Inspector removal | Potential | Zero overhead + smaller bundle | Production builds |
