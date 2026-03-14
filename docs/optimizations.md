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

**On `derived()` — pull-phase caching:**

```ts
const category = derived(
  [score],
  () => (score.get() >= 90 ? 'A' : score.get() >= 80 ? 'B' : 'C'),
  { equals: (a, b) => a === b }
)
```

When `equals` is provided, `derived` stores cache their last output. If the recomputed value equals the cached one, the cached reference is returned.

**Important limitation:** `equals` on derived is a **pull-phase-only** optimization. It does **not** suppress DIRTY propagation to downstream sinks. When an upstream dep changes, the derived store unconditionally pushes DIRTY downstream. Downstream effects and subscribers still wake up, call `get()`, and run — `equals` only ensures `get()` returns the cached reference instead of the new-but-equal value. For `subscribe`, the built-in `Object.is(next, prev)` check in the subscriber will then skip the user callback, but the subscriber still ran. For `effect`, the effect function runs unconditionally.

To truly skip downstream work when a derived output stabilizes, see [Selective subscription](#selective-subscription-fine-grained-reactivity) in potential future optimizations.

**On `stream()` — skip emit for equal values:**

```ts
const position = stream<{ x: number; y: number }>(
  (emit) => { /* high-frequency emitter */ },
  { equals: (a, b) => a.x === b.x && a.y === b.y }
)
```

**When to use:** `state` — skip DIRTY propagation entirely for equal values. `derived` — return stable references from `get()` (reference stability, not propagation savings). `stream` — skip emit for equal values. All types benefit from object/array equality where structural comparison is needed.

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

**Approach B — DIRTY barrier derived (eager-compare-then-propagate):**

```ts
// Hypothetical API
const name = derived([user], () => user.get().name, { barrier: true })
// On receiving DIRTY: eagerly re-runs fn(), compares with equals,
// only pushes DIRTY downstream if the value actually changed.
```

The pure callbag refactor (explicit deps arrays) makes this feasible: deps are static and known upfront, so a derived store can safely pull from its deps during the push phase without tracking surprises.

The `equals` option on derived currently provides only the **pull-phase half** — it returns cached references from `get()` but does not suppress DIRTY propagation. A barrier derived would add the **push-phase half**: suppress DIRTY to downstream sinks when the output hasn't changed.

#### Pipe chain concern: stale values from eager pull during DIRTY propagation

The barrier approach requires a derived store to call `get()` on its deps **during** DIRTY propagation (inside `pushDirty`). This creates a problem in `pipe()` chains, where each operator is a separate `derived` store chained via callbag wiring:

```
state A → derived B (map) → derived C (filter) → derived D (map) → effect
```

DIRTY propagates depth-first through the callbag graph. When A changes:
1. A pushes DIRTY to B's sink
2. B receives DIRTY, and if B is a barrier, it eagerly calls `B.get()` → `A.get()` ✓ (A is already updated)
3. B decides to propagate → pushes DIRTY to C's sink
4. C receives DIRTY, eagerly calls `C.get()` → `B.get()` → `A.get()` ✓ (still fine, sequential)

In a **linear chain**, this works because DIRTY propagates step-by-step and each node can pull from already-updated ancestors.

The concern is **diamond dependencies**:

```
state A → derived B → derived D → effect
         ↘ derived C ↗
```

1. A pushes DIRTY to B's sink, then C's sink (in order of `sinks` Set iteration)
2. B receives DIRTY, eagerly computes B.get() ✓
3. B pushes DIRTY to D's sink
4. D receives DIRTY, eagerly computes D.get() → calls B.get() ✓ and C.get()
5. **Problem:** C hasn't received DIRTY yet — `C.get()` returns a stale value computed from old A
6. Later, C receives DIRTY, but D already made its barrier decision with stale data

This is the classic "glitch" problem in reactive systems. The current design avoids it by deferring all computation to the pull phase (effects call `get()` after all DIRTY has propagated). A barrier derived would need to solve this, possible approaches:

- **Topological ordering:** Ensure DIRTY propagates in topological order so all deps are updated before any barrier computes. Adds complexity and requires maintaining a DAG.
- **Two-pass propagation:** First pass propagates DIRTY everywhere, second pass does eager comparison bottom-up. Effectively doubles the cost of propagation.
- **Barrier only at leaf-adjacent positions:** Restrict barriers to derived stores whose sinks are only effects/subscribers (never other derived stores). Simpler but limits usefulness.
- **`pipeRaw()` as the practical answer:** Since `pipeRaw()` fuses all transforms into a single `derived` store, there are no intermediate nodes to glitch. A barrier on a `pipeRaw()` store is safe and covers the most common use case (linear transform chains).

#### `pipeRaw` input memoization — the viable first step

`pipeRaw(source, f1, f2, f3)` compiles to `derived([source], ...)` — a single dep, no diamond possible. This makes it safe to add implicit **input memoization**: when DIRTY arrives, eagerly call `source.get()`, compare with the previous input via `Object.is`, and suppress DIRTY to downstream sinks if unchanged.

This composes naturally with `equals` on upstream derived stores:

```
state A → derived B (equals: ...) → pipeRaw(B, f1, f2, f3) → effect
```

1. A changes → DIRTY propagates unconditionally through B to pipeRaw
2. pipeRaw eagerly calls `B.get()` → B recomputes, `equals` returns cached reference
3. pipeRaw compares: `Object.is(newInput, prevInput)` → same reference → suppress DIRTY
4. Effect never wakes up — transforms never run

This is **input memoization** (compare inputs, skip transforms entirely), not output memoization (run transforms, compare outputs). For `pipeRaw` with pure transform functions, input stability implies output stability, so input comparison is strictly cheaper. It does not catch cases where the input changes but the output stabilizes (e.g., clamping, rounding) — that would require running the transforms eagerly and comparing outputs, which is a separate additive optimization.

Why this is safe:
- `pipeRaw` has exactly one dep — `source` is already updated when it pushes DIRTY
- Transforms are pure functions of their input value — no side effects, no external store reads
- No diamond concern: a single-dep derived cannot observe partially-propagated state

### Compile-time Inspector removal

A Babel/SWC plugin or separate entry point (`callbag-recharge/slim`) that removes all Inspector calls at build time, saving ~1 KB from the bundle and guaranteeing zero per-store overhead without runtime flag checks.

---

## Summary

| Optimization | Status | Impact | When to use |
|---|---|---|---|
| `Inspector.enabled = false` | Built-in | 6.8x faster store creation | Production builds |
| `equals` on state | Built-in | Skip DIRTY propagation entirely | Object/array state |
| `equals` on derived | Built-in | Stable references from `get()` (pull-phase only, does **not** skip DIRTY) | Stabilizing derived outputs |
| `equals` on stream | Built-in | Skip emit for equal values | High-frequency streams |
| `batch()` | Built-in | 3.3x for multi-set patterns | Concurrent state updates |
| `pipeRaw()` + `SKIP` | Built-in | Single derived store for pipe chain | Hot pipe chains, SKIP filter semantics |
| Raw callbag interop | Built-in | ~2x for pure streaming | Hot paths, no store needed |
| Memoized derived (userland) | Userland pattern | Skip expensive recomputation | Heavy computation functions |
| `pipeRaw` input memoization | Potential (viable) | Suppress DIRTY when input unchanged | pipeRaw + upstream `equals` |
| Selective subscription (general) | Potential (hard) | Fine-grained reactivity, requires glitch solution | Diamond dependency graphs |
| Compile-time Inspector removal | Potential | Zero overhead + smaller bundle | Production builds |
