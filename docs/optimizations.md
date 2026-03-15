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

---

## Potential optimizations

These are not yet implemented but represent concrete opportunities for improvement, ordered by expected impact.

### 1. Memory footprint reduction (~30x gap vs Preact)

**Status:** Not implemented. **Impact:** High.

Recharge stores use ~3,600 bytes/store vs Preact's ~118 bytes/store. The gap comes from:

- **Closure-based stores:** Each `producer()` / `derived()` creates ~10 closure variables (`currentValue`, `started`, `completed`, `sinks`, `cleanup`, `pendingEmission`, etc.). V8 allocates a shared closure context object for these.
- **Eager `Set` allocation:** Every store allocates a `new Set()` for sinks at creation, even if no subscriber ever connects. Most stores in a typical app are intermediate derived nodes that may have 0–1 sinks.
- **Inspector WeakRef:** When enabled, each store gets a `new WeakRef()` added to a global Set.

The approaches below address these in order of impact.

#### 1a. Class + prototype methods

Replace closure-based factories with classes. Methods on the prototype are allocated once and shared across all instances. V8 applies hidden class optimization — fields at fixed offsets, not a hash map — yielding dense, monomorphic memory layout. This is the primary reason Preact achieves 118 bytes/store.

```ts
// Current: per-instance closure context + ~6 inner function objects per producer
function producer<T>(fn?, opts?) {
  let currentValue: T | undefined = opts?.initial
  const sinks = new Set<any>()
  // ...
  function doEmit(value: T) { ... }    // new function object per producer
  function doSignal(s: Signal) { ... } // new function object per producer
  // ...
}

// With class: methods on prototype — one allocation, shared across all instances
class Producer<T> {
  _value: T | undefined
  _sinks: Set<any> | null = null  // lazy — see 1b
  // ...

  emit(value: T) { ... }    // Producer.prototype.emit — shared
  signal(s: Signal) { ... } // Producer.prototype.signal — shared
  source(type: number, payload?: any) { ... }
}
```

V8 JIT-compiles prototype methods once and reuses the compiled code for every instance (monomorphic call sites). The current closure approach produces a unique function object for each `doEmit`, `doSignal`, etc. per `producer()` call — meaning 10,000 stores allocate 60,000+ distinct function objects.

#### 1b. Lazy `_sinks = null`

Initialize sinks as `null` instead of `new Set()`. Allocate the Set only when the first subscriber connects via `source(START, ...)`. For pull-only stores (`.get()` without subscribers), this eliminates the Set entirely.

```ts
// Current: Set allocated at construction, even for pull-only stores
const sinks = new Set<any>()

// With lazy init: null until first sink, compatible with class approach
class Producer<T> {
  _sinks: Set<any> | null = null

  source(type: number, sink: any) {
    if (type === START) {
      if (!this._sinks) this._sinks = new Set()
      this._sinks.add(sink)
      // ...
    }
  }

  _broadcast(type: number, data?: any) {
    if (!this._sinks) return  // null check replaces sinks.size === 0
    for (const sink of this._sinks) sink(type, data)
  }
}
```

An empty `Set` costs ~200 bytes in V8. In a graph with 1,000 stores where 900 are intermediate derived nodes with a single downstream subscriber that is wired at app startup, the `sinks` Set is populated immediately and lazy init provides no benefit. But for stores created speculatively or used only in pull mode, this saves ~200 bytes each.

#### 1c. Remove `update()`

`update(fn)` is syntactic sugar over `set(fn(get()))` and exists only on `WritableStore` (state). Removing it saves one property slot per state store and one prototype method. Callers write `s.set(fn(s.get()))` instead.

#### 1d. Pass `this` as actions (partial)

Currently `startProducer()` creates a fresh object on every producer start to pass to the user-supplied `fn`:

```ts
// Current: new object + 4 property references allocated on every start
const result = fn({ emit: doEmit, signal: doSignal, complete: doComplete, error: doError })
```

With a class, the producer instance itself carries those methods, so `this` can be passed directly — eliminating the wrapper object allocation:

```ts
class Producer<T> {
  _start() {
    // Pass this directly — no wrapper object created
    const result = this._fn?.(this)
    this._cleanup = typeof result === 'function' ? result : undefined
  }
}

// User fn receives the Producer instance:
producer(function(p) {
  const id = setInterval(() => p.emit(Date.now()), 1000)
  return () => clearInterval(id)
})
```

**Limitation:** The talkback closure inside `source()` and the sink callbacks in the callbag handshake still require closures — they must capture per-connection state (which sink to respond to, the specific depIndex in `derived`). Passing `this` eliminates only the top-level actions object, not the per-connection closures.

### 2. `endDeferredStart()` uses O(n²) `shift()`

**Status:** Not implemented. **Impact:** Medium (connection batching with many deps).

```ts
// Current: O(n²) — shift() copies remaining array on each call
while (pendingStarts.length > 0) {
  const start = pendingStarts.shift();
  if (start) start();
}

// Fix: O(n) — index-based drain (same pattern as batch())
for (let i = 0; i < pendingStarts.length; i++) {
  pendingStarts[i]();
}
pendingStarts.length = 0;
```

The `batch()` drain loop already uses the index-based pattern. `endDeferredStart()` should match. The impact scales with the number of deps in a single `effect()` or `derived()` — an effect with 20 deps queues 20 pending starts.

### 3. Effect performance (~1.4x slower than Preact)

**Status:** Not implemented. **Impact:** Medium.

Effects are the one benchmark where Preact wins (~14M vs ~10M ops/sec). The overhead comes from:

- **Type 3 DIRTY/RESOLVED round-trip:** Each dep change sends DIRTY (type 3) → effect tracks dirty count → DATA (type 1) → dirty count decrements → when zero, `fn()` runs. Preact's effects use a simpler version/flag check.
- **`dirtyDeps` Set operations:** `add()`, `has()`, `delete()`, `size` checks per signal per dep.
- **Enqueue/flush cycle:** The deferred start mechanism adds overhead at connection time.

**Possible approaches:**

- **Integer bitmask for dirty deps:** For effects with ≤32 deps (covers nearly all real-world cases), replace the `Set<number>` with a single `number` bitmask. `dirtyDeps |= (1 << depIndex)` to mark dirty, `dirtyDeps &= ~(1 << depIndex)` to resolve, `dirtyDeps === 0` to check settled. Bitwise ops are ~10x faster than Set operations.
- **Fast-path for single-dep effects:** Skip dirty counting entirely when `deps.length === 1` — any DATA means "run now". No Set allocation needed.

### 4. Derived `get()` always recomputes when unconnected

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

### 5. Compile-time Inspector removal

**Status:** Not implemented. **Impact:** Low (bundle size + micro-optimization).

A Babel/SWC plugin or separate entry point (`callbag-recharge/slim`) that removes all Inspector calls at build time, saving ~1 KB from the bundle and guaranteeing zero per-store overhead without runtime flag checks.

The current `Inspector.enabled` getter accesses `process.env.NODE_ENV` through a try/catch on every call. While this is only hit during store creation (not hot paths), a build-time solution eliminates the runtime cost entirely.

### 6. `Inspector.enabled` getter caching

**Status:** Not implemented. **Impact:** Low.

The default `enabled` getter runs a try/catch to access `process.env.NODE_ENV` on every call:

```ts
get enabled(): boolean {
  if (this._explicitEnabled !== null) return this._explicitEnabled;
  try {
    return (globalThis as any).process?.env?.NODE_ENV !== "production";
  } catch {
    return true;
  }
}
```

Once resolved, the result won't change. Cache it after first access to avoid repeated try/catch overhead during bulk store creation.

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
| Class + prototype methods | Potential | Biggest memory win — shared methods, V8 hidden class layout | All stores |
| Lazy `_sinks = null` | Potential | ~200 bytes/store for pull-only stores | Pull-only / speculative stores |
| Remove `update()` | Potential | One fewer slot per state store | State stores |
| Pass `this` as actions | Potential | Eliminates actions wrapper object per producer start | Producer-based stores |
| `endDeferredStart()` O(n) drain | Potential | Faster connection batching | Effects/derived with many deps |
| Integer bitmask dirty tracking | Potential | Faster effect re-runs, close 1.4x gap vs Preact | Effects and derived with ≤32 deps |
| Single-dep fast path | Potential | Skip dirty counting overhead | Single-dep effects/derived |
| Unconnected derived caching | Potential | Skip redundant `fn()` on pull | Pull-only derived stores |
| Compile-time Inspector removal | Potential | Zero overhead + smaller bundle | Production builds |
| `Inspector.enabled` getter caching | Potential | Avoid repeated try/catch | Bulk store creation |
