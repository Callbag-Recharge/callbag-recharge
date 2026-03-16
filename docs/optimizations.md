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
- **~5.8x faster** store creation (see [benchmarks](./benchmarks.md#inspector-disabled-vs-enabled-store-creation))

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

With v4's optimized operator internals, `pipeRaw` and `pipe` have roughly the same throughput (~19M ops/sec). The benefit of `pipeRaw` is reduced store count and memory (one store instead of N), not throughput.

**When to use:** Pipe chains where you want to minimize store allocations, don't need per-step inspectability or `scan`, or need `SKIP` filter semantics.

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

### 7. Class-based primitives with output slot model — v4 architecture

`ProducerImpl`, `StateImpl`, `DerivedImpl`, and `OperatorImpl` use classes with prototype method sharing and V8 hidden class optimization. `effect()` uses a pure closure (see rationale below). The factory functions (`producer()`, `state()`, `derived()`, `operator()`, `effect()`) are preserved as the public API.

**v4 results:**
- Memory per store: ~719 bytes (Inspector ON, ~6x gap vs Preact's ~121 bytes)
- Store creation (Inspector OFF): 6.4M ops/sec
- Store creation (Inspector ON): 1.1M ops/sec
- Throughput: wins in most benchmarks except diamond patterns (see [benchmarks](./benchmarks.md))

**v4 STANDALONE overhead:** Derived nodes eagerly connect to deps at construction, maintaining active output slots, talkback references, and `_chain` closures even without external subscribers. This ensures `get()` always returns a current cached value but adds per-store cost vs v3's lazy model (~719 vs ~354 bytes). The tradeoff is correctness and API simplicity over memory.

**Class + prototype methods:** Methods live on the prototype and are shared across all instances. Public API methods (`source`, `emit`, `signal`, `complete`, `error`, `set`) are bound in the constructor so they work when detached (callbag interop, destructuring). `ProducerImpl._start()` passes `this` directly to the user-supplied `fn`, eliminating the actions wrapper object allocation per start.

**Why effect is a closure, not a class:** A/B benchmarking showed class wins ~30% on creation (V8 hidden class allocation) but closure wins ~20-30% on re-run (closure-local variable access vs `this._property` lookups). Since effects are created once but triggered many times, the re-run hot path dominates. Additionally, `EffectImpl` had only 1 own property (`_dispose`) and 1 prototype method, with zero `instanceof` usage in the library — the class provided no structural benefit. ProducerImpl/OperatorImpl/DerivedImpl justify their class overhead through multiple prototype methods and the need for `.source`, `.get()`, `.set()` etc.

**Output slot (null → fn → Set):** All classes use a lazy output slot instead of a `_sinks` Set. The slot starts as `null` (no subscribers), becomes a single function reference on first subscriber (SINGLE mode), and only allocates a Set on the second subscriber (MULTI mode). Nodes with ≤1 subscriber never allocate a Set (~200 bytes saved per node).

**Remaining gap vs Preact (~6x):** Preact's ~121 bytes/store reflects its simpler model — no per-instance bound functions, bitfield flags, and no STANDALONE connections. Recharge v4's `_chain` closure assembly, STANDALONE talkback references, and Inspector registration (WeakRef/WeakMap) are the primary costs. Paths to close the gap include fusing chain closures for single-dep nodes and compile-time Inspector removal.

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

## Known regressions (v3 correctness pass) — partially mitigated

The correctness pass (resubscribable, completion reentrancy safety, operator getter/reset) added necessary overhead. Four optimizations were applied to mitigate:

1. **`_flags` bitmask** — Packed 6 boolean fields (ProducerImpl), 3 (OperatorImpl), 3 (DerivedImpl) into single integers. Reduces V8 hidden class size by 5 properties per ProducerImpl, saves ~40 bytes/store.
2. **Local `completed` variable in operator actions** — Operator action closures (`emit`, `signal`, `seed`) check a closure-local `completed` boolean instead of `this._flags & bit`. Local variable access is faster than property lookup in V8 hot paths.
3. **Snapshot-free completion** — `complete()`/`error()` move the `_sinks` reference to a local and null the field before iterating, instead of allocating `[...this._sinks]`. The old Set serves as the iteration target; re-subscriptions during END create a new Set (since `this._sinks` is null). Zero allocation.
4. **Effect pure closure** — `effect()` uses closure-captured locals (`dirtyDeps`, `anyDataReceived`, `disposed`, `cleanup`) instead of class instance properties. A/B benchmarks showed closure wins ~20-30% on re-run (the hot path) vs class, despite class winning ~30% on creation. Since effects are created once but triggered many times, closure is the right choice.

### Measured impact (isolated, GC-controlled)

| Metric | Before optimization | After optimization | Change |
|---|---|---|---|
| Memory per store (Inspector OFF) | 473 B | 433 B | **-8.5%** |
| Memory per store (Inspector ON) | 599 B | 559 B | **-6.7%** |

Throughput changes are within run-to-run variance for most benchmarks. The optimizations primarily reduce memory per store and allocation pressure during completions.

### Remaining overhead from correctness pass

These are intentional costs that cannot be eliminated without removing features:

- **`_resubscribable` flag bit + `source()` branch** — checked on subscription, needed for retry/rescue/repeat
- **`_completed` checks on `emit()`/`signal()` in ProducerImpl** — needed because producer methods are bound and can be called after completion by user code
- **`_getterFn` and `_initial` fields on OperatorImpl** — needed for tier 2 operator parity (getter pull-fallback, resetOnTeardown)
- **`seed` action in operator actions object** — needed for operators that set initial values during init

---

## Potential optimizations

These are not yet implemented but represent concrete opportunities for improvement.

### 1. Derived `get()` caching — resolved by STANDALONE

**Status:** Resolved in v4. **Impact:** N/A.

In v3, unconnected derived stores recomputed `fn()` on every `.get()` call. v4's STANDALONE mode solves this — derived nodes eagerly connect at construction, so `_value` is always populated by the active pipeline. `get()` returns the cached `_value` directly (~160M ops/sec for unchanged deps).

### 2. Compile-time Inspector removal

**Status:** Not implemented. **Impact:** Low (bundle size + micro-optimization).

A Babel/SWC plugin or separate entry point (`callbag-recharge/slim`) that removes all Inspector calls at build time, saving ~1 KB from the bundle and guaranteeing zero per-store overhead without runtime flag checks.

---

## v4 optimization considerations

The output slot model, plugin composition, and ADOPT protocol introduce new performance surfaces. This section maps foreseeable optimization targets and trade-offs.

### Construction time

**Chain assembly cost.** Each transform node assembles `_chain` at construction: composing closures for stateIntercept, map(fn), valueIntercept, and the output slot. This is a fixed one-time cost per node. Closures are cheap (V8 allocates a closure context ~50-100 bytes), but the chain can be 4-5 closures deep per node.

- **Optimization:** Fuse stateIntercept + map + valueIntercept into a single closure where possible. Single-dep nodes with no `equals` option can collapse the entire chain into one function that reads upstream, applies fn, writes `_value`, updates `_status`, and dispatches to the output slot. This eliminates 2-3 intermediate closure allocations per node.
- **Tradeoff:** Fused closures are harder to debug (Inspector hooks need explicit call sites rather than intercept points). Consider a debug/production split: full chain in dev, fused chain in prod.

**Plugin wiring cost.** Each plugin (StorePlugin, ControlPlugin, SourcePlugin, AdoptPlugin, optionally FanInPlugin) adds properties and methods to the node. If plugins are mix-in style (copy properties onto `this`), construction pays for each plugin's setup.

- **Optimization:** Use class hierarchies or conditional prototype chains rather than runtime mix-ins. E.g., `SingleDepOperator extends BaseNode` vs `MultiDepOperator extends BaseNode` — V8 creates stable hidden classes for each, avoiding the megamorphic deopt that mix-ins cause.
- **Optimization:** For the common single-dep case (most operators), skip FanInPlugin entirely — no bitmask allocation, no `depValues[]` array. The savings is one `number` and one `Array` per single-dep node.

**Output slot allocation.** The output slot starts as `null` (no subscribers), becomes a single function reference (SINGLE mode), and only allocates a Set on the second subscriber (MULTI mode). This is already optimal — lazy allocation matches the common case where most nodes have 0-1 subscribers.

### Runtime (signal propagation)

**Output slot dispatch overhead.** In SINGLE mode, the output slot is a direct function call — zero overhead vs v3. In MULTI mode, it iterates a Set. The question is whether the SINGLE → MULTI transition introduces a branch cost.

- **Optimization:** Use a flags bit (`O_MULTI`) to distinguish modes. A single `if (flags & O_MULTI)` branch is cheaper than checking `typeof _sinks === 'function'` or `_sinks instanceof Set`.
- **Expected impact:** Negligible for most graphs. Only matters for nodes with high fan-out (10+ subscribers) where Set iteration dominates.

**Tap cost per signal.** Every DATA signal through B._chain writes `B._value` and `B._status` — two property writes per node per signal. In a deep chain (A → B → C → D → E), a single state change causes 2 × depth property writes.

- **Optimization:** If a node has no external `.get()` callers and no Inspector hooks, the tap writes are wasted. A `O_TAP_NEEDED` flag could skip the writes when the node is purely a pipeline passthrough.
- **Tradeoff:** Determining "no external .get() callers" statically is hard. This is a speculative optimization — measure first.

**REQUEST_ADOPT / GRANT_ADOPT cost.** The ADOPT protocol runs once per topology change (subscribe/unsubscribe), not per signal. It sends two type 3 signals through the chain. This is negligible unless topology changes happen at high frequency (e.g., dynamic subscription operators).

- **Optimization:** For static topologies (most apps), the ADOPT protocol fires only during initialization. No optimization needed.
- **Optimization:** For dynamic topologies (switchMap, flat), the inner subscription should skip the ADOPT protocol entirely — inner nodes are ephemeral and don't need terminator handoff. A `O_SKIP_ADOPT` flag on ephemeral inner chains avoids the round-trip.

**FanIn bitmask at convergence points.** The bitmask algorithm is O(1) per signal (bitwise ops). For multi-dep nodes with > 32 deps, a fallback to `Uint32Array` or multiple bitmask words is needed.

- **Optimization:** Keep the fast path as a single `number` for ≤ 32 deps (covers ~100% of real-world cases). Only allocate the typed array fallback if `deps.length > 32`.

### Memory footprint

**Per-node cost breakdown (estimated for v4):**

| Component | Bytes (approx.) | Notes |
|-----------|-----------------|-------|
| `_value` | 8 | pointer/inline |
| `_status` | 8 | enum/string ref |
| `_flags` | 8 | packed bitmask |
| `_chain` closure | 50-100 | V8 closure context |
| Output slot ref | 8 | null / fn / Set ref |
| Talkback ref | 8 | upstream talkback |
| Inspector WeakRef | 16 | when Inspector.enabled |
| FanInPlugin (if multi-dep) | +40 | bitmask + depValues array |
| AdoptPlugin state | +8 | route stack ref (null when idle) |
| **Total (single-dep, Inspector OFF)** | **~100-160** | |
| **Total (multi-dep, Inspector ON)** | **~200-260** | |

**Measured v4:** ~719 bytes/store (Inspector ON). The estimate above is for the raw node structure; actual cost includes STANDALONE connection overhead (talkback closures, active `_chain` pipeline), Inspector WeakRef/WeakMap registration, and bound method closures. The STANDALONE model trades memory for always-current `get()` semantics. Preact's ~121 bytes/store reflects its simpler model with no eager connections.

**Output slot Set allocation.** Sets are ~200 bytes each. Nodes with ≤1 subscriber never allocate one. For graphs where most nodes feed into exactly one downstream (typical), this saves ~200 bytes × (total nodes - fan-out points).

**Chain closure sharing.** When multiple nodes use the same transform function (e.g., `map(x => x * 2)` reused), V8 shares the function object. But the closure *context* (capturing `_value`, `_status` refs) is per-node. No sharing opportunity there.

### Batch + output slot interaction

Batch defers DATA, not DIRTY. In v4, DIRTY propagates through output slots immediately (phase 1), then DATA propagates at batch drain (phase 2). Output slots in MULTI mode dispatch DIRTY to all sinks synchronously — this is correct but means DIRTY fan-out is unbatched.

- **Observation:** This is identical to v3 behavior (DIRTY was never deferred). No regression.
- **Potential optimization:** If DIRTY fan-out becomes a bottleneck (unlikely — DIRTY is a single Symbol, no computation), batch could defer DIRTY too. But this breaks the invariant that all dirty state is established before DATA flows, which is critical for diamond resolution. **Do not defer DIRTY.**

### Fused pipe + output slot fusion

v4 splits the fused pipe into two variants:

- **`pipeRaw(source, ...fns)`** — fuses into a single `operator()` store (lazy, DISCONNECTED when no subscribers). Bare minimum — no auto-connect, no internal terminator. This is the "raw" flavor for hot paths where the caller controls the subscription lifecycle.
- **`pipeDerived(source, ...fns)`** — fuses into a single `derived()` store (auto-connects, STANDALONE when no subscribers, `.get()` always current). This is the renamed version of what v3 called `pipeRaw`.

Both fuse N transform functions into one `_chain` with one output slot instead of N chains with N output slots. The savings are multiplicative: N-1 fewer chains, output slots, taps, and Inspector registrations.

- **v4 enhancement:** Both variants should skip creating intermediate nodes entirely. Each transform function is folded into a single composed `fn` inside one `_chain`. The stateIntercept and valueIntercept wrap only the final composed function.
- `SKIP` sentinel provides filter semantics in both variants.

### Lazy plugin instantiation

Not all plugins are needed at construction time:

| Plugin | When actually needed |
|--------|---------------------|
| StorePlugin | Always (defines `_value`, `_status`, `get()`) |
| ControlPlugin | Always for tier 1 (STATE forwarding is part of chain assembly) |
| FanInPlugin | Only for multi-dep nodes |
| SourcePlugin | On first `source(START, sink)` call |
| AdoptPlugin | On first topology change |

- **Optimization:** SourcePlugin and AdoptPlugin could be lazily mixed in on first use. But this changes the hidden class shape after construction, which is a V8 deopt. **Not recommended.** Better to pre-declare all fields in the constructor (even as `null`) to keep the hidden class stable.

### Summary of v4 optimization priorities

| Priority | Optimization | Expected impact | Effort |
|----------|-------------|-----------------|--------|
| **P0** | Skip FanInPlugin for single-dep nodes | ~40 bytes/node, fewer allocations | Low |
| **P0** | Lazy output slot (null → fn → Set) | ~200 bytes saved for ≤1 subscriber | Low (already designed) |
| **P1** | Fused chain closure for single-dep | 2-3 fewer closures per node (~150 bytes) | Medium |
| **P1** | `O_SKIP_ADOPT` for ephemeral inner chains | Avoids ADOPT round-trip in switchMap/flat | Low |
| **P2** | `O_TAP_NEEDED` flag to skip tap writes | 2 fewer writes per signal per passthrough node | Medium (needs static analysis) |
| **P2** | Class hierarchy instead of runtime mix-ins | Stable hidden classes, avoids megamorphic | Medium |
| **P3** | pipeRaw/pipeDerived fusion with single chain | N-1 fewer chains for N-step pipes | Low (extends existing design) |
| **P3** | Compile-time Inspector removal | Zero overhead + smaller bundle | Medium (tooling) |

---

## Summary

| Optimization | Status | Impact | When to use |
|---|---|---|---|
| `Inspector.enabled = false` | Built-in | ~5.8x faster store creation | Production builds |
| `equals` on state | Built-in | Skip DIRTY propagation entirely | Object/array state |
| `equals` on derived | Built-in | Push-phase memoization via RESOLVED — skips entire downstream subtrees | Stabilizing derived outputs |
| `equals` on producer | Built-in | Skip emit for equal values | High-frequency producers |
| `batch()` | Built-in | Coalesces multi-set patterns | Concurrent state updates |
| `pipeRaw()` + `SKIP` | Built-in | Single fused store for pipe chain, reduced store count | SKIP filter semantics, memory-sensitive paths |
| Raw callbag interop | Built-in | ~4.7x for pure streaming | Hot paths, no store needed |
| Memoized derived (userland) | Userland pattern | Skip expensive recomputation | Heavy computation functions |
| Class + output slot model | Built-in | V8 hidden class optimization, lazy output slot (null → fn → Set) | All stores and effects |
| STANDALONE derived | Built-in | `get()` always returns current cached value (~160M ops/sec unchanged) | All derived stores |
| `endDeferredStart()` O(n) drain | Built-in | Faster connection batching | Effects/derived with many deps |
| Integer bitmask dirty tracking | Built-in | ~10x faster dirty ops vs Set, eliminates Set allocation | Effects and derived with ≤32 deps |
| `Inspector.enabled` getter caching | Built-in | Avoid repeated try/catch | Bulk store creation |
| `_flags` bitmask (boolean packing) | Built-in | ~40 bytes/store saved, smaller hidden class | All stores |
| Local `completed` in operator actions | Built-in | Faster hot-path action closures | Operator emit/signal |
| Snapshot-free completion | Built-in | Zero allocation on complete/error | Completion-heavy workloads |
| Effect pure closure (not class) | Built-in | ~20-30% faster re-run vs class | Effects |
| Compile-time Inspector removal | Potential | Zero overhead + smaller bundle | Production builds |
