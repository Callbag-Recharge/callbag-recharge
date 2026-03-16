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
- **~5.6x faster** store creation (see [benchmarks](./benchmarks.md#inspector-disabled-vs-enabled-store-creation))

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
- Effect coalescing shines with many effects or deep dependency graphs where batching prevents redundant re-runs

**When to use:** Any code path that updates multiple state stores and has active effects or subscribers downstream.

### 4. `pipeRaw()` — fused pipe with a single operator store

`pipe()` creates one `operator`/`derived` store per operator (each with its own Inspector registration and output slot). `pipeRaw()` fuses all transform functions into a single `operator` store.

```ts
import { pipeRaw, SKIP } from 'callbag-recharge/extra'

const result = pipeRaw(
  source,
  (n: number) => n * 2,
  (n: number) => n > 0 ? n : SKIP,  // SKIP = filter semantics
  (n: number) => n + 1,
)

result.get() // runs all 3 transforms in one operator() call
```

- `SKIP` sentinel replaces filter — returns the last non-skipped value (or `undefined` if nothing has passed yet)
- Type overloads for up to 4 transforms
- No `scan` support (use regular `pipe()` with the `scan` operator for accumulator state)

With optimized operator internals, `pipeRaw` and `pipe` have roughly the same throughput (~17M ops/sec). The benefit of `pipeRaw` is reduced store count and memory (one store instead of N), not throughput. Use `pipeRaw` when you need the `SKIP` sentinel for filter semantics or want to minimize store allocations.

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

Raw callbag operators are nested function calls with zero allocation — **~4.6x faster** than recharge pipes. The tradeoff is no `.get()`, no Inspector visibility, and no store interop (pure push, no pull).

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

### 7. Class-based primitives with output slot model

`ProducerImpl`, `StateImpl`, `DerivedImpl`, and `OperatorImpl` use classes with prototype method sharing and V8 hidden class optimization. `effect()` uses a pure closure (see rationale below). The factory functions (`producer()`, `state()`, `derived()`, `operator()`, `effect()`) are preserved as the public API.

**Measured results:**
- Memory per store: ~719 bytes (Inspector ON, ~6x gap vs Preact's ~121 bytes)
- Store creation (Inspector OFF): 7.3M ops/sec
- Store creation (Inspector ON): 1.3M ops/sec
- Throughput: wins in most benchmarks except diamond patterns and state write (see [benchmarks](./benchmarks.md))

**STANDALONE overhead:** Derived nodes eagerly connect to deps at construction, maintaining active output slots and talkback references even without external subscribers. This ensures `get()` always returns a current cached value but adds per-store cost vs a lazy model. The tradeoff is correctness and API simplicity over memory.

**Class + prototype methods:** Methods live on the prototype and are shared across all instances. Public API methods (`source`, `emit`, `signal`, `complete`, `error`, `set`) are bound in the constructor so they work when detached (callbag interop, destructuring). `ProducerImpl._start()` passes `this` directly to the user-supplied `fn`, eliminating the actions wrapper object allocation per start.

**Why effect is a closure, not a class:** A/B benchmarking showed class wins ~30% on creation (V8 hidden class allocation) but closure wins ~20-30% on re-run (closure-local variable access vs `this._property` lookups). Since effects are created once but triggered many times, the re-run hot path dominates. Additionally, `EffectImpl` had only 1 own property (`_dispose`) and 1 prototype method, with zero `instanceof` usage in the library — the class provided no structural benefit. ProducerImpl/OperatorImpl/DerivedImpl justify their class overhead through multiple prototype methods and the need for `.source`, `.get()`, `.set()` etc.

**Output slot (null -> fn -> Set):** All classes use a lazy output slot instead of a `_sinks` Set. The slot starts as `null` (no subscribers), becomes a single function reference on first subscriber (SINGLE mode), and only allocates a Set on the second subscriber (MULTI mode). Nodes with <=1 subscriber never allocate a Set (~200 bytes saved per node).

**Remaining gap vs Preact (~6x):** Preact's ~121 bytes/store reflects its simpler model — no per-instance bound functions, bitfield flags, and no STANDALONE connections. Handler closure assembly, STANDALONE talkback references, and Inspector registration (WeakRef/WeakMap) are the primary costs.

### 8. `endDeferredStart()` O(n) drain

`endDeferredStart()` uses an index-based `for` loop + `length = 0` (O(n)) instead of `while/shift()` (O(n^2)), matching the `batch()` drain pattern. Impact scales with the number of deps in a single `effect()` or `derived()`.

### 9. Integer bitmask for dirty dep tracking

Both `effect()` and `DerivedImpl` use a single `number` bitmask instead of `Set<number>` for dirty dep tracking. Bitwise operations replace Set methods:

- `dirtyDeps |= (1 << depIndex)` — mark dirty (was `set.add()`)
- `dirtyDeps & (1 << depIndex)` — check dirty (was `set.has()`)
- `dirtyDeps &= ~(1 << depIndex)` — resolve (was `set.delete()`)
- `dirtyDeps === 0` — check settled (was `set.size === 0`)

Bitwise ops are ~10x faster than Set operations. The `Bitmask` class handles >32 deps via `Uint32Array` fallback with O(1) `empty()` check. Also eliminates the Set allocation (~200 bytes per effect).

### 10. `Inspector.enabled` getter caching

The default `enabled` getter resolves `process.env.NODE_ENV` through a try/catch only once. The result is cached in `_cachedDefault` and returned directly on subsequent calls. `_reset()` clears the cache for test isolation.

### 11. `_flags` bitmask (boolean packing)

Packed 6 boolean fields (ProducerImpl), 3 (OperatorImpl), 3 (DerivedImpl) into single integers. Reduces V8 hidden class size by 5 properties per ProducerImpl, saves ~40 bytes/store.

### 12. Local `completed` variable in operator actions

Operator action closures (`emit`, `signal`, `seed`) check a closure-local `completed` boolean instead of `this._flags & bit`. Local variable access is faster than property lookup in V8 hot paths.

### 13. Snapshot-free completion

`complete()`/`error()` move the `_sinks` reference to a local and null the field before iterating, instead of allocating `[...this._sinks]`. The old Set serves as the iteration target; re-subscriptions during END create a new Set (since `this._sinks` is null). Zero allocation.

### 14. Effect pure closure

`effect()` uses closure-captured locals (`dirtyDeps`, `anyDataReceived`, `disposed`, `cleanup`) instead of class instance properties. A/B benchmarks showed closure wins ~20-30% on re-run (the hot path) vs class, despite class winning ~30% on creation. Since effects are created once but triggered many times, closure is the right choice.

---

## Potential optimizations

These are not yet implemented but represent concrete opportunities for improvement.

### 1. State write (no subscribers) — narrow the gap with Preact

**Status:** Not implemented. **Impact:** High (3.5x gap).

The current benchmark shows Preact at 34M ops/sec vs recharge at 9.8M ops/sec for state writes with no subscribers. The gap comes from recharge's two-phase push protocol — even with `_output === null`, `set()` still runs through the `equals` guard and output slot dispatch code path. Opportunities:

- **Fast path for null output:** When `_output === null` and no inspector hooks are active, `set()` could update `_value` directly and skip DIRTY/DATA dispatch entirely. This is safe because no one is listening.
- **Inline `Object.is` check:** The `equals` function is currently called via a property lookup. For the default `Object.is` case, inlining the check avoids the function call overhead.
- **Expected impact:** Could close the gap to ~1.5-2x, bringing state write to ~20-25M ops/sec.

### 2. Compile-time Inspector removal

**Status:** Not implemented. **Impact:** Low-medium (bundle size + micro-optimization).

A Babel/SWC plugin or separate entry point (`callbag-recharge/slim`) that removes all Inspector calls at build time, saving ~1 KB from the bundle and guaranteeing zero per-store overhead without runtime flag checks.

### 3. Memory footprint reduction

**Status:** Not implemented. **Impact:** Medium (currently ~6x gap vs Preact).

The ~719 bytes/store cost breaks down across STANDALONE connections, handler closures, bound methods, and Inspector registration. Concrete opportunities:

- **Lazy method binding:** Only bind `source`, `get`, `set` etc. on first access via getter traps instead of eagerly in the constructor. Most stores only use 1-2 of their bound methods. Saves ~48 bytes per unused bound method (6 bytes per pointer * 8 methods).
- **`derived.from(dep, opts?)` — singleton handler for identity transforms:** A dedicated factory for single-dep identity derived nodes. Because there is no user-supplied transform function, the handler closure is a shared singleton rather than a per-node allocation. Covers three use cases: bare passthrough (`derived.from(dep)`), custom equality (`derived.from(dep, { equals: shallowEqual })`), and named observation points (`derived.from(dep, { name: 'alias' })`). Also naturally fits the single-dep P0 optimization path.
- **WeakRef-free Inspector:** Replace `WeakRef<Store>` with a `FinalizationRegistry` that removes entries when stores are GC'd. This eliminates the per-store WeakRef allocation (~16 bytes).

### 4. Diamond pattern optimization

**Status:** Not implemented. **Impact:** Medium (1.4x gap vs Preact).

The diamond benchmark (6.9M vs 9.8M ops/sec) is the main throughput gap. STANDALONE mode means intermediate derived nodes maintain active output slots even when only the final node is read. Opportunities:

- **Lazy STANDALONE activation:** Defer STANDALONE connection until the first `.get()` call rather than at construction. Stores that are only consumed via subscription (not polled) skip STANDALONE overhead entirely.
- **Output slot bypass for single-subscriber chains:** When A -> B -> C and B has exactly one subscriber (C), B's output slot dispatch could be replaced with a direct function call to C's handler, eliminating the mode check and Set lookup.
- **Topological sort for batch drain:** When multiple nodes settle in a batch, drain in topological order (sources first) to avoid redundant intermediate recomputes.

### ~~5. Handler closure fusion for single-dep chains~~

**Removed.** `pipeRaw()` already fuses transforms into a single store, and benchmarks show `pipe` vs `pipeRaw` throughput is nearly identical (17M vs 16.7M ops/sec). The ~100-150 bytes/node memory saving doesn't justify the engine complexity when users can opt into `pipeRaw` for memory-sensitive paths.

---

## Summary

| Optimization | Status | Impact | When to use |
|---|---|---|---|
| `Inspector.enabled = false` | Built-in | ~5.6x faster store creation | Production builds |
| `equals` on state | Built-in | Skip DIRTY propagation entirely | Object/array state |
| `equals` on derived | Built-in | Push-phase memoization via RESOLVED — skips entire downstream subtrees | Stabilizing derived outputs |
| `equals` on producer | Built-in | Skip emit for equal values | High-frequency producers |
| `batch()` | Built-in | Coalesces multi-set patterns | Concurrent state updates |
| `pipeRaw()` + `SKIP` | Built-in | Single fused store for pipe chain, reduced store count | SKIP filter semantics, memory-sensitive paths |
| Raw callbag interop | Built-in | ~4.6x for pure streaming | Hot paths, no store needed |
| Memoized derived (userland) | Userland pattern | Skip expensive recomputation | Heavy computation functions |
| Class + output slot model | Built-in | V8 hidden class optimization, lazy output slot (null -> fn -> Set) | All stores and effects |
| STANDALONE derived | Built-in | `get()` always returns current cached value (~232M ops/sec unchanged) | All derived stores |
| `endDeferredStart()` O(n) drain | Built-in | Faster connection batching | Effects/derived with many deps |
| Integer bitmask dirty tracking | Built-in | ~10x faster dirty ops vs Set, eliminates Set allocation | Effects and derived with <=32 deps |
| `Inspector.enabled` getter caching | Built-in | Avoid repeated try/catch | Bulk store creation |
| `_flags` bitmask (boolean packing) | Built-in | ~40 bytes/store saved, smaller hidden class | All stores |
| Local `completed` in operator actions | Built-in | Faster hot-path action closures | Operator emit/signal |
| Snapshot-free completion | Built-in | Zero allocation on complete/error | Completion-heavy workloads |
| Effect pure closure (not class) | Built-in | ~20-30% faster re-run vs class | Effects |
| State write fast path | Potential | Close 3.5x gap with Preact on no-subscriber writes | State-heavy apps |
| Compile-time Inspector removal | Potential | Zero overhead + smaller bundle | Production builds |
| Memory footprint reduction | Potential | Close 6x gap via lazy binding, shared closures | Memory-sensitive apps |
| Diamond pattern optimization | Potential | Close 1.4x gap via lazy STANDALONE, output bypass | Diamond-heavy graphs |
| ~~Handler closure fusion~~ | Removed | Superseded by `pipeRaw()` | — |
