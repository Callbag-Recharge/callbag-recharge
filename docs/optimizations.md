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
- **~5.6x faster** store creation (see [benchmarks](./benchmarks.md))

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

### 6. `cached()` — input-level memoization for expensive computations

The `cached()` extra operator provides input-level memoization. It compares *inputs* rather than *outputs* — useful when the computation itself is expensive (>1ms) and inputs change less often than DIRTY propagates.

**Factory form** — `cached([deps], fn, opts?)`:

```ts
import { cached } from 'callbag-recharge/extra'

const result = cached([inputA, inputB], () => {
  return heavyComputation(inputA.get(), inputB.get())
})
```

When **connected** (subscribed): push-based, diamond-safe via dirty-dep bitmask counting (built on `operator()`). Multi-dep cached uses the same `Bitmask`-based diamond resolution as `derived()` — DIRTY sets bits, DATA/RESOLVED clears them, recompute only fires when all dirty deps resolve. When **disconnected**: `get()` checks if dep values changed (via `Object.is`) against a cached input snapshot. If unchanged, returns cached output without calling `fn()`.

**Pipe form** — `cached(eq?)`:

```ts
const deduped = pipe(source, cached<number>())
// or with custom equality:
const deduped = pipe(source, cached<User>((a, b) => a.id === b.id))
```

Output dedup + cached getter for disconnected reads. Equivalent to `distinctUntilChanged` with a cached getter. Sends RESOLVED on duplicate values.

**When to use:** Expensive derived computations where you want to avoid recomputation when deps haven't changed (factory form). Output dedup with cached disconnected reads (pipe form).

For simple manual memoization without the operator, you can also memoize at the call site:

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

### 7. Class-based primitives with output slot model

`ProducerImpl`, `StateImpl`, `DerivedImpl`, and `OperatorImpl` use classes with prototype method sharing and V8 hidden class optimization. `effect()` uses a pure closure (see rationale below). The factory functions (`producer()`, `state()`, `derived()`, `operator()`, `effect()`) are preserved as the public API.

**Measured results:**
- Memory per store: ~719 bytes (Inspector ON, ~6x gap vs Preact's ~121 bytes)
- Store creation (Inspector OFF): 7.3M ops/sec
- Store creation (Inspector ON): 1.3M ops/sec
- Throughput: wins in most benchmarks except diamond patterns and state write (see [benchmarks](./benchmarks.md))

**Disconnect-on-unsub:** Derived nodes disconnect from deps when the last subscriber leaves and reconnect when a new subscriber arrives. `get()` pull-computes from deps when disconnected (always fresh, zero ongoing cost). This eliminates the per-store cost of maintaining active connections for unsubscribed derived stores.

**Class + prototype methods:** Methods live on the prototype and are shared across all instances. Only commonly detached methods (`source`, `emit`, `set`) are bound in the constructor. `_start()` passes a lightweight actions wrapper `{ emit, signal, complete, error }` to the user-supplied `fn` — `signal`/`complete`/`error` use arrow functions (not bound methods), allocated only when the producer starts and GC'd when it stops. With D3's lazy start, construction is hotter than start, so this is a net win (~30 bytes/store saved).

**Why effect is a closure, not a class:** A/B benchmarking showed class wins ~30% on creation (V8 hidden class allocation) but closure wins ~20-30% on re-run (closure-local variable access vs `this._property` lookups). Since effects are created once but triggered many times, the re-run hot path dominates. Additionally, `EffectImpl` had only 1 own property (`_dispose`) and 1 prototype method, with zero `instanceof` usage in the library — the class provided no structural benefit. ProducerImpl/OperatorImpl/DerivedImpl justify their class overhead through multiple prototype methods and the need for `.source`, `.get()`, `.set()` etc.

**Output slot (null -> fn -> Set):** All classes use a lazy output slot instead of a `_sinks` Set. The slot starts as `null` (no subscribers), becomes a single function reference on first subscriber (SINGLE mode), and only allocates a Set on the second subscriber (MULTI mode). Nodes with <=1 subscriber never allocate a Set (~200 bytes saved per node).

**Remaining gap vs Preact (~6x):** Preact's ~121 bytes/store reflects its simpler model — no per-instance bound functions, bitfield flags. Handler closure assembly and Inspector registration (WeakRef/WeakMap) are the primary costs.

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

Packed 6 boolean fields (ProducerImpl), 4 (OperatorImpl), 6 (DerivedImpl) into single integers. Reduces V8 hidden class size by 5 properties per ProducerImpl, saves ~40 bytes/store.

### 12. Local `completed` variable in operator actions

Operator action closures (`emit`, `signal`, `seed`) check a closure-local `completed` boolean instead of `this._flags & bit`. Local variable access is faster than property lookup in V8 hot paths.

### 13. Snapshot-free completion

`complete()`/`error()` move the `_sinks` reference to a local and null the field before iterating, instead of allocating `[...this._sinks]`. The old Set serves as the iteration target; re-subscriptions during END create a new Set (since `this._sinks` is null). Zero allocation.

### 14. Effect pure closure

`effect()` uses closure-captured locals (`dirtyDeps`, `anyDataReceived`, `disposed`, `cleanup`) instead of class instance properties. A/B benchmarks showed closure wins ~20-30% on re-run (the hot path) vs class, despite class winning ~30% on creation. Since effects are created once but triggered many times, closure is the right choice.

### 15. State write fast path

`StateImpl.set()` inlines the `ProducerImpl.emit()` logic, eliminating the bound method call overhead. For the no-subscriber case (`_output === null`), `set()` is just an equality check + value assignment — no DIRTY/DATA dispatch.

- `set()` skips the `this.emit(value)` bound method hop (~5-10ns saved per call)
- `_eqFn` is always set for state, so the `_eqFn &&` guard is removed
- `update(fn)` now calls `this.set()` instead of `this.emit()`

**Measured results:** State write (no subscribers) improved from 9.8M to 47M ops/sec — from 3.5x slower than Preact to 1.3x faster. See [benchmarks](./benchmarks.md#state-write-no-subscribers).

### 16. Integer `_status` packed into `_flags` bits 7-9

Replaced string `_status` property ("DIRTY", "SETTLED", "RESOLVED", etc.) with 3-bit integer packed into `_flags` bits 7-9. Six `NodeStatus` values map to integers 0-5. All status writes on the hot path are now register-only bitwise operations instead of heap pointer writes.

```ts
// Before (string write — heap pointer, ~3-5ns):
this._status = "DIRTY";

// After (integer bitwise — register-only, ~0.5-1ns):
this._flags = (this._flags & ~STATUS_MASK) | _S_DIRTY;
```

Applied to `ProducerImpl`, `StateImpl`, `DerivedImpl`, and `OperatorImpl`. String `_status` exposed via `get _status()` getter calling `decodeStatus()` for Inspector/test backward compat. The hot path (signal dispatch) never calls the getter.

Protocol additions in `src/core/protocol.ts`: `S_DISCONNECTED=0` through `S_ERRORED=5`, `STATUS_SHIFT=7`, `STATUS_MASK=0b111<<7`, `decodeStatus(flags)`.

**Measured impact:** Diamond pattern improved from ~6.8x to ~3.8x gap vs Preact. State write (no subs) improved from ~1.7x to ~1.2x gap.

### 17. Bounded reactiveLog circular buffer

Replaced O(n) `_entries.splice(0, overflow)` with a real circular buffer for bounded mode. Uses a fixed-size array with `_head` (oldest entry index) and `_count` fields. Append overwrites `_entries[_head]` and advances the head pointer — O(1) instead of O(n).

**Measured impact:** bounded reactiveLog vs ring buffer improved from **~10.8x → 2.54x** gap (4.3x improvement). The remaining 2.54x gap is the reactive overhead (version counter bump + event emission per append).

### 18. Skip DIRTY dispatch via SINGLE_DEP signaling

When not batching, `state.set()` dispatches DIRTY then immediately dispatches DATA — two function calls through the output slot per subscriber. For single-dep subscribers (derived, effect, operator with one dep), DIRTY is pure overhead: DATA follows synchronously, and diamond resolution isn't needed.

**Solution:** Source-side SINGLE_DEP signaling via the callbag talkback reverse channel. When a single-dep subscriber connects to a source, it sends `talkback(STATE, SINGLE_DEP)` after receiving the START talkback. The source sets a `P_SKIP_DIRTY` flag (bit 10 in `_flags`). In the unbatched `emit()`/`set()` path, DIRTY dispatch is skipped when `P_SKIP_DIRTY` is set.

**Safety invariants:**
- `P_SKIP_DIRTY` is cleared on SINGLE→MULTI transition (second subscriber added)
- `P_SKIP_DIRTY` is cleared on subscriber disconnect (SINGLE→null)
- `P_SKIP_DIRTY` is cleared on `complete()`/`error()` (terminal — resubscribable nodes must start clean)
- `P_SKIP_DIRTY` is restored on MULTI→SINGLE when the remaining subscriber is single-dep (tracked via `_singleDepCount`)
- `_singleDepCount` reset to 0 on full disconnect, complete, or error
- During batching, DIRTY is still dispatched (the skip only applies to the unbatched `else` branch)
- Derived synthesizes DIRTY for its own downstream when it receives DATA-without-DIRTY (lines 174-176 in `_connectSingleDep`)
- Multi-dep derived handles DATA-without-DIRTY correctly (dirtyDeps empty → synthesize DIRTY + recompute)

**MULTI→SINGLE restoration:** Each talkback closure tracks a local `isSingleDep` boolean. `_singleDepCount` on ProducerImpl aggregates these across all active subscribers (8 bytes per store). On MULTI→SINGLE (Set.size drops to 1), if `_singleDepCount > 0`, `P_SKIP_DIRTY` is restored — the remaining subscriber is single-dep and the optimization applies.

**Dispatch savings:**
- state → effect(single-dep): 2 dispatches → 1 (50% reduction)
- state → derived(single-dep) → downstream: 4 dispatches → 3 (25% reduction)
- state → operator(single-dep) → downstream: 4 dispatches → 2 (50% reduction, operator doesn't synthesize DIRTY)
- state(MULTI) → anything: no change (SKIP_DIRTY not set in MULTI mode)

### 19. Reduced bound methods in ProducerImpl (3 instead of 6)

ProducerImpl constructor now binds only `source` and `emit` (2 instead of 5). StateImpl adds `set`. That's 3 total function allocations per `state()` creation (~24 bytes per store on V8) instead of 6 (~48 bytes).

`signal`, `complete`, and `error` are no longer bound in the constructor. `_start()` passes a lightweight actions wrapper `{ emit, signal, complete, error }` to the user-supplied `fn`. The wrapper uses arrow functions for `signal`/`complete`/`error`, allocated only when the producer starts and GC'd when it stops. All 47+ extras that destructure `{ emit, signal, complete, error }` from the producer fn continue to work.

### 20. Streamlined DISCONNECTED↔SINGLE transition

With D3's disconnect-on-unsub, `_connectUpstream()` and `_disconnectUpstream()` are now hot paths. Both `DerivedImpl` and `OperatorImpl` reuse the `_upstreamTalkbacks` array instead of allocating a new one on every reconnect cycle:

```ts
// Before (allocates new array):
this._upstreamTalkbacks = [];

// After (reuses existing array):
this._upstreamTalkbacks.length = 0;
```

### 21. Version-gated collection stores

Replaced `state<MemoryNode[]>` (which allocated a new array on every add/remove) with a version counter + lazy `derived()` materialization (same pattern as reactiveMap). `_nodesStore` is now `derived([_version], () => Array.from(_nodes.values()))` — only allocates when observed. `_sizeStore` is `derived([_version], () => _nodes.size)` — no array allocation. Also simplified node ID generation by removing `Date.now()` call.

**Measured impact:** collection x50 + byTag improved from **~41.6x → 29.4x** gap. Remaining gap is dominated by per-node overhead: each `memoryNode` creates 3 reactive stores + 1 derived, and collection creates per-node tag-tracking effects + reactive eviction policy. The `reactiveScored` evict+reinsert benchmark shows a 19.6x gap — this is the primary remaining bottleneck.

### 22. SINGLE_DEP for `dynamicDerived`

`dynamicDerived()` now uses the same SINGLE_DEP optimization as `derived()` and `operator()`. When a `dynamicDerived` has exactly one tracked dep, it sends `talkback(STATE, SINGLE_DEP)` to skip redundant DIRTY dispatch in unbatched paths.

**Implementation:** Two code paths in `_connectUpstream()`:
- **Single-dep** (`_connectSingleDep()`): closure-local `dirty` boolean, no bitmask. Sends SINGLE_DEP on START. Handles DATA-without-DIRTY by synthesizing DIRTY for downstream. Guards against double DIRTY (`if (dirty) return;`).
- **Multi-dep**: unchanged bitmask path via `_connectOneDep()`.

**Rewire safety:** When deps change between recomputations, old connections are disconnected (clearing SINGLE_DEP on the source). The `_connectOneDep()` method (used during rewire) does NOT send SINGLE_DEP — only `_connectSingleDep()` does, which is used for initial `_connectUpstream()` when `deps.length === 1`. This avoids a performance regression where SINGLE_DEP would tell the producer to skip DIRTY but the bitmask handler would re-synthesize it anyway.

**Double DIRTY guard:** Both `derived._connectSingleDep()` and `dynamicDerived._connectSingleDep()` now guard against cascading double DIRTY signals with `if (dirty) return;`.

**Dispatch savings:** Same as derived SINGLE_DEP — 50% reduction for single-dep unbatched paths.

### 23. Cancellation via AbortController in `taskState`

`taskState.run(fn)` now passes an `AbortSignal` to `fn`, enabling proactive cancellation of in-flight async work. Previously, `reset()`/`restart()`/`destroy()` bumped a generation counter to discard stale results, but the async work continued running to completion.

```ts
await task.run((signal) => fetch('/api/data', { signal }));
task.reset(); // aborts the fetch immediately
```

**Implementation:**
- `run()` creates a new `AbortController`, passes `signal` to `fn`, clears on completion
- `reset()` / `restart()` / `destroy()` call `controller.abort()` before bumping generation
- The generation counter is retained as a secondary guard — abort is proactive, generation is defensive
- All orchestrate callers forward signal to user functions:
  - `task(deps, (signal, values) => ...)` — signal first, dep values as array
  - `forEach(dep, (signal, item, index) => ...)` — signal first, then positional args
  - `onFailure(dep, (signal, error) => ...)` — signal first, then error
  - `sensor(dep, (signal, value) => ...)` — signal first, then value
  - `loop(deps, (signal, values) => ...)` — signal first, dep values as array
  - `subPipeline(deps, (signal, values) => ...)` — signal first, dep values as array
  - `join()` — internal only, no user fn

**API changes:**
- `TaskState.run()`: `(fn: (signal: AbortSignal) => T | Promise<T>) => Promise<T>`
- All orchestrate step callbacks: signal is always the first parameter (Go `ctx` convention)

### 24. Shared timer runtime (`createTicker`)

Extracted an internal `createTicker(tickMs, onTick)` helper in `utils/timer.ts` that centralizes all duplicated timer lifecycle logic from `countdown()` and `stopwatch()`.

**`Ticker` interface:** `start()`, `pause()` (returns partial-tick delta), `resume()`, `stop()` (no delta), `active` (readonly), `disposed` (readonly), `dispose()`.

**What it consolidates:**
- interval creation/teardown (`clearInterval`/`setInterval`)
- `lastTick` bookkeeping with `Date.now()` delta
- partial-tick flushing on pause
- disposed/active guard handling

Both `countdown` and `stopwatch` now delegate all timer mechanics to their `Ticker` instance. Public interfaces unchanged.

---

## Potential optimizations

These are not yet implemented but represent concrete opportunities for improvement.

### 1. Compile-time Inspector removal

**Status:** Not implemented. **Impact:** Low-medium (bundle size + micro-optimization). **Priority:** Low — not worth pursuing while the library is still in active development.

A Babel/SWC plugin or separate entry point (`callbag-recharge/slim`) that removes all Inspector calls at build time, saving ~1 KB from the bundle and guaranteeing zero per-store overhead without runtime flag checks.


---

<details>
<summary><strong>## Not implementing (click to expand)</strong></summary>

### ~~1. Memory footprint reduction~~

**Not implementing.** The ~6x gap vs Preact (~719 vs ~122 bytes/store) is structural — output slot model, handler closures, bound methods, and callbag protocol overhead. The remaining sub-items don't justify their complexity:

- **~~Lazy method binding:~~** V8 hidden class transitions from getter→own-property (via `defineProperty` on first access) cause inline cache invalidation. All bound methods (`source`, `set`, `emit`, `signal`, `complete`, `error`) are legitimately detached in callbag interop and destructuring patterns. Savings (~40-50 bytes/instance) don't offset the hidden class pollution and first-access latency.
- **~~WeakRef-free Inspector:~~** `FinalizationRegistry` alone cannot support `graph()` iteration — it only fires callbacks on GC, it cannot query "what's alive". The only alternative (strong refs + registry cleanup) is more complex with no meaningful memory reduction. Inspector is disabled in production anyway, so the ~60-80 bytes/store WeakRef cost only applies in dev.

Note: The previous STANDALONE overhead concern (derived eagerly connecting to deps at construction) is no longer applicable — derived now disconnects from deps when unsubscribed and pull-computes on `get()`.

### ~~2. Diamond pattern — topological sort / output bypass~~

**Not implementing.** The diamond gap vs Preact is inherent to the two-phase push protocol. Preact uses lazy pull — `computed` only recomputes when `.value` is accessed. Recharge uses eager push — DIRTY propagates immediately through all paths, then DATA follows. For a diamond A→B,C→D, Recharge sends 6 signals (DIRTY×3 + DATA×3); Preact marks one dirty flag and pulls on read. This is an architectural difference, not something fixable with micro-optimizations:

- **~~Output slot bypass for single-subscriber chains:~~** The current SINGLE mode already IS the bypass — `_dispatch` checks a `P_MULTI` bitflag (~1-2 CPU cycles) then calls the function directly. V8's JIT monomorphizes this.
- **~~Topological sort for batch drain:~~** The dirty-bitmask already handles diamond resolution correctly. FIFO and topological produce the same result (no redundant recomputes).

**Note:** Potential optimization #1 (skip DIRTY) will improve diamond throughput as a side effect, but the fundamental gap comes from push-vs-pull architecture. Accept this tradeoff — push gives us real-time effects and predictable timing, which pull cannot.

### ~~3. Handler closure fusion for single-dep chains~~

**Not implementing.** `pipeRaw()` already fuses transforms into a single store, and benchmarks show `pipe` vs `pipeRaw` throughput is nearly identical (18M vs 18M ops/sec). The ~100-150 bytes/node memory saving doesn't justify the engine complexity when users can opt into `pipeRaw` for memory-sensitive paths.

### ~~4. Array-backed output slot for fan-out~~

**Not implementing.** Investigated and found negligible gain. Modern V8 optimizes `for...of` on small Sets to be nearly as fast as indexed array iteration — the iterator allocation overhead that motivated this has been eliminated by the engine. Set retains two advantages that Array cannot match: O(1) `delete(sink)` on unsubscribe (vs O(n) `indexOf` + `splice`) and automatic dedup (prevents double-subscription without explicit checks). At typical subscriber counts (1-10), the dispatch hot path shows no measurable difference.

### ~~5. Inline `Object.is` in state.set() equality check~~

**Not implementing.** `state.set()` calls `this._eqFn!(old, new)` — an indirect call through a stored reference. For the default case (99% of stores), `_eqFn` is `Object.is`. V8 cannot inline through the indirect call. The proposed fix was a `P_DEFAULT_EQ` flag to branch between `Object.is` directly vs `_eqFn`. However, V8's inline cache (IC) monomorphizes the `_eqFn` call site after the first invocation — subsequent calls go through a fast IC stub, not a full indirect dispatch. The measured ~3-5ns gap is within noise for real workloads. The added flag complexity and branch in the hot path is not justified.

### ~~6. `validationPipeline` composition refactor~~

**Not implementing.** The implementation is already well-composed — `effect([source])` watches changes, `derived` computes combined errors/valid, proper `AbortController` handles async cancellation. The remaining procedural code (debounce timer + async orchestration) is inherently imperative and wouldn't benefit from reactive abstraction. Replacing `setTimeout` with a reactive debounce operator would add complexity without simplifying the code.

### ~~7. Pull-compute version check for disconnected derived.get()~~

**Not implementing.** With D3, disconnected `derived.get()` calls `_fn()` every time. A version stamp on deps would let `get()` skip recomputation when deps haven't changed. However, the overhead of adding and syncing version counters across the graph outweighs the benefit:

- Every `state.set()` must bump a version (~0.5ns, negligible alone).
- But for derived-depends-on-derived chains (common in real apps), the inner derived also needs a version, creating recursive version validation — essentially the same cost as pull-computing.
- For trivial `_fn` (e.g., `() => a.get() + b.get()`), the version check (N reads + N compares) costs as much as just calling `_fn()`. The win only materializes for expensive `_fn` with primitive (state) deps.

**Alternative (userland):** Users with genuinely expensive derived computations can compose an explicit memoization operator — e.g., a `memo()` or `cached()` extra that wraps the heavy `_fn` and skips recomputation based on input equality or a version check. This keeps the cost opt-in and avoids burdening every derived store with version tracking overhead. The existing "Memoized derived stores (userland)" pattern (Built-in optimization #6 in this doc) already covers the manual approach; a dedicated operator would formalize it. This also complements Level 3's `NodeV0.version` pattern — the operator could expose a version for data structures that need it, without forcing it into core primitives.

</details>


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
| `cached()` (factory + pipe) | Built-in (extra) | Input-level memoization for expensive computations; cached disconnected reads | Expensive derived fns, output dedup |
| Class + output slot model | Built-in | V8 hidden class optimization, lazy output slot (null -> fn -> Set) | All stores and effects |
| Lazy derived (disconnect-on-unsub) | Built-in | `get()` pull-computes from deps when disconnected (always fresh); zero ongoing cost for unsubscribed derived | All derived stores |
| `endDeferredStart()` O(n) drain | Built-in | Faster connection batching | Effects/derived with many deps |
| Integer bitmask dirty tracking | Built-in | ~10x faster dirty ops vs Set, eliminates Set allocation | Effects and derived with <=32 deps |
| `Inspector.enabled` getter caching | Built-in | Avoid repeated try/catch | Bulk store creation |
| `_flags` bitmask (boolean packing) | Built-in | ~40 bytes/store saved, smaller hidden class | All stores |
| Local `completed` in operator actions | Built-in | Faster hot-path action closures | Operator emit/signal |
| Snapshot-free completion | Built-in | Zero allocation on complete/error | Completion-heavy workloads |
| Effect pure closure (not class) | Built-in | ~20-30% faster re-run vs class | Effects |
| State write fast path | Built-in | Inlined `set()` — 9.8M→47M ops/sec (now 1.3x faster than Preact) | State-heavy apps |
| `derived.from()` | Built-in | Identity transform, skips `fn()` on recompute | Passthrough, dedup, observation |
| Integer `_status` in `_flags` | Built-in | Eliminates string writes on every signal dispatch; diamond ~6.8x→3.8x | All hot paths |
| Bounded reactiveLog circular buffer | Built-in | O(1) append instead of O(n) splice; gap ~10.8x→2.54x | Bounded logs |
| Version-gated collection stores | Built-in | Lazy materialization; collection gap ~41.6x→29.4x | Collections with reactive views |
| Skip DIRTY (SINGLE_DEP signaling) | Built-in | 50% fewer dispatches for single-dep unbatched paths | Effect re-run, simple chains |
| Reduced bound methods (6→3) | Built-in | ~30 bytes/store saved, fewer constructor allocations | All stores |
| Streamlined DISCONNECTED↔SINGLE | Built-in | Reuses `_upstreamTalkbacks` array on reconnect | Derived sub/unsub cycles |
| SINGLE_DEP for dynamicDerived | Built-in | 50% fewer dispatches for single-dep dynamic deriveds | Conditional-dep nodes with one active dep |
| `taskState` AbortController cancellation | Built-in | Proactive abort of in-flight tasks on reset/restart/destroy | Pipelines with long-running async tasks |
| Shared timer runtime (`createTicker`) | Built-in | Deduplicated timer lifecycle code; lower maintenance risk | Timer utils |
| Compile-time Inspector removal | Potential (low priority) | Zero overhead + smaller bundle | Production builds |

| ~~`validationPipeline` composition~~ | Not implementing | Already well-composed; remaining procedural code is inherently imperative | — |
| ~~Inline `Object.is` in state.set()~~ | Not implementing | V8 IC monomorphizes `_eqFn` call; measured gap within noise | — |
| ~~Pull-compute version check~~ | Not implementing | Version syncing overhead ≈ pull-compute cost; userland `memo()` operator preferred | — |
| ~~Memory footprint reduction~~ | Not implementing | ~6x gap is structural; lazy binding and WeakRef-free don't justify complexity | — |
| ~~Diamond pattern — topo sort / output bypass~~ | Not implementing | Gap is architectural (push vs pull); micro-opts won't close it | — |
| ~~Handler closure fusion~~ | Not implementing | Superseded by `pipeRaw()` | — |
| ~~Array-backed fan-out output slot~~ | Not implementing | V8 optimizes small Set iteration; Set keeps O(1) delete + dedup | — |
