# Optimizations

callbag-recharge deliberately trades some performance for simplicity and correctness. This document describes opt-in techniques to close the gaps identified in the [benchmarks](./benchmarks.md).

---

## 1. Memoized derived stores

The largest performance gap is cached vs uncached computed reads (6x). For derived stores with expensive computation functions, wrap the function in a memoization layer:

```ts
import { state, derived } from 'callbag-recharge'

function memo<T>(fn: () => T): () => T {
  let cached: T
  let prevDeps: any[] = []

  return () => {
    // Collect dependency values for shallow comparison
    const deps: any[] = []
    const result = fn() // runs fn, which calls .get() on deps
    // If deps haven't changed, return cached
    // (requires explicit dep tracking — see below)
    return result
  }
}
```

A more practical approach — wrap at the call site:

```ts
const expensive = derived(() => {
  const a = inputA.get()
  const b = inputB.get()
  return heavyComputation(a, b)
})

// Add memoization externally:
let lastA: number, lastB: number, lastResult: number
const memoized = derived(() => {
  const a = inputA.get()
  const b = inputB.get()
  if (a === lastA && b === lastB) return lastResult
  lastA = a; lastB = b
  return (lastResult = heavyComputation(a, b))
})
```

**When to use:** Only when the computation function is measurably expensive (>1ms). For simple expressions like `a.get() + b.get()`, the overhead of memoization checks exceeds the cost of recomputation.

**Why it's not built in:** Caching requires dirty flags, version counters, or dependency value comparison — all sources of subtle bugs. The no-cache default is correct by construction. Memoization is opt-in complexity for the rare cases that need it.

---

## 2. Lighter pipe operators

The pipe benchmark shows a 16x gap vs raw callbag. Each pipe operator (`map`, `filter`, `scan`) creates a full `derived` store with:

- Inspector registration
- A `Set` for sinks
- Upstream talkback management
- Tracking context setup on every `.get()`

For hot paths where inspectability isn't needed, consider using raw callbag operators directly:

```ts
import cbPipe from 'callbag-pipe'
import cbMap from 'callbag-map'
import cbFilter from 'callbag-filter'

// Hot path — use raw callbag for zero overhead
cbPipe(
  store.source,
  cbMap(n => n * 2),
  cbFilter(n => n > 0),
  cbSubscribe(v => { /* ... */ }),
)
```

Every store's `.source` property is a standard callbag source, so raw callbag operators plug in directly.

**Future direction:** A `pipeRaw()` function could create a single derived store that composes multiple transformations into one function call, avoiding intermediate stores:

```ts
// Hypothetical — single store, multiple transforms
const result = pipeRaw(
  source,
  n => n * 2,          // map
  n => n > 0 ? n : undefined,  // filter
  n => (n ?? 0) + 1,   // map
)
```

This would be ~3x faster than the current `pipe()` while still being a readable store.

---

## 3. Production mode (skip Inspector registration)

Every store created via `state()`, `derived()`, or `stream()` calls `Inspector.register()`. While the registration itself is cheap (~a WeakRef + WeakMap set), it adds up when creating thousands of stores.

For production builds, the Inspector can be made a no-op:

```ts
// In your build config or entry point:
import { Inspector } from 'callbag-recharge'

// Disable registration for production
Inspector.reset() // clears existing registrations

// Or, tree-shake by not importing Inspector at all —
// registration is fire-and-forget, so unused Inspector
// methods will be dead code in bundlers that support it.
```

**Future direction:** A compile-time flag or separate entry point (`callbag-recharge/slim`) that omits Inspector entirely, saving ~1 KB from the bundle and eliminating per-store registration overhead.

---

## 4. Batched state updates

When updating multiple state stores at once, each `.set()` triggers its own DIRTY propagation. For diamond-heavy graphs, this means redundant propagation:

```ts
// Each set() propagates DIRTY independently
a.set(1)
b.set(2)
c.set(3)
```

A `batch()` function could defer DIRTY propagation until all updates are applied:

```ts
import { batch } from 'callbag-recharge'

batch(() => {
  a.set(1)
  b.set(2)
  c.set(3)
}) // DIRTY propagates once, effects flush once
```

The propagation batching infrastructure (`depth` counter + `pending` queue) already supports this — `batch()` would increment depth before the callback and decrement after, ensuring effects flush only once.

---

## 5. Structural sharing for collections

State stores use `Object.is` for equality. For objects and arrays, this means every `.set()` with a new reference triggers DIRTY, even if the contents are identical:

```ts
const list = state([1, 2, 3])
list.set([1, 2, 3]) // new reference → triggers DIRTY
```

A custom equality function would skip unnecessary propagation:

```ts
const list = state([1, 2, 3], {
  equals: (a, b) => JSON.stringify(a) === JSON.stringify(b)
  // or use a deep-equal library
})
```

**Future direction:** An `opts.equals` parameter on `state()` that replaces the `Object.is` check. This is a small, backward-compatible addition.

---

## 6. Selective subscription (fine-grained reactivity)

Currently, any change to a state store notifies all downstream derived stores, even if the specific property they depend on didn't change:

```ts
const user = state({ name: 'Alice', age: 30 })
const name = derived(() => user.get().name) // re-runs on ANY user change
```

Two approaches to avoid unnecessary recomputation:

**Approach A — Split into granular stores:**

```ts
const name = state('Alice')
const age = state(30)
const nameUpper = derived(() => name.get().toUpperCase()) // only re-runs on name change
```

**Approach B — Selector-based derived:**

```ts
// Hypothetical API
const name = select(user, u => u.name) // only propagates DIRTY when .name changes
```

This would require derived stores to compare their output value with the previous one before propagating DIRTY downstream — a form of memoization at the output rather than the input.

---

## Summary

| Optimization | Effort | Impact | When to use |
|---|---|---|---|
| Memoized derived | Low (userland) | 6x for cached reads | Expensive computation functions |
| Raw callbag pipes | Low (userland) | 16x for pipe throughput | Hot streaming paths |
| Skip Inspector | Low (config) | ~15% fewer allocations | Production builds |
| batch() | Medium (library) | Fewer propagation cycles | Multi-store updates |
| Custom equals | Low (library) | Skip unnecessary DIRTY | Object/array state |
| Selectors | Medium (library) | Fine-grained reactivity | Large object stores |

The first three are available today without library changes. The latter three are potential library enhancements.
