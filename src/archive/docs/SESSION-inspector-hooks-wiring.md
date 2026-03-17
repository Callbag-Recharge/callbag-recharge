# Session: Inspector Hooks Wiring & Debugging DX

**Date:** 2026-03-16
**Goal:** Make Inspector useful for real debugging — wire hooks into primitives, auto-register edges, add dumpGraph(), and demonstrate usage in tests.

---

## What we built

### 1. Signal hooks wired into all 4 primitives

Inspector already had `onEmit`, `onSignal`, `onStatus`, `onEnd` hook slots defined but they were **never called** from the primitives. The comment in the test said _"integration comes in Phase 9"_. We completed that integration:

- **`state.set()`** — fires `onEmit` (after `_output` check, so no-subscriber writes skip it), `onStatus` on DIRTY and SETTLED transitions
- **`producer.emit()`** — same pattern as state, plus `onSignal` in `signal()`, `onEnd` in `complete()`/`error()`
- **`derived._recompute()`** — fires `onEmit` on recompute, `onStatus` on SETTLED/RESOLVED, `onEnd` on upstream END
- **`operator` actions** — `emit()`, `signal()`, `complete()`, `error()` all fire corresponding hooks

### 2. Auto-registered edges

Previously `Inspector.registerEdge()` was manual. Now:
- `DerivedImpl` constructor calls `registerEdge(dep, this)` for each dep
- `OperatorImpl` constructor calls `registerEdge(dep, this)` for each dep

This means `Inspector.getEdges()` and `dumpGraph()` show the full dependency graph automatically.

### 3. `Inspector.dumpGraph()`

Pretty-prints the entire store graph for console/CLI debugging:
```
Store Graph (3 nodes):
  count (state) = 42  [SETTLED]
  doubled (derived) = 84  [SETTLED]
  label (derived) = "value=84"  [SETTLED]
```

### 4. `setHooks()` / `clearHooks()` API

```ts
Inspector.setHooks({
  onEmit: (store, value) => console.log(`${Inspector.getName(store)}: ${value}`),
  onStatus: (store, status) => console.log(`${Inspector.getName(store)}: ${status}`),
});
// ... debug ...
Inspector.clearHooks(); // production: disables all hooks
```

---

## Performance journey

### The problem

Adding `if (Inspector.onEmit) Inspector.onEmit(...)` checks in hot paths caused significant regression:

| Benchmark | Before | Naive hooks | Regression |
|---|---|---|---|
| State write (no sub) | 46M | 33.6M | -27% |
| Computed after dep change | 18.1M | 12.1M | -33% |
| Operator | 28.1M | 12.2M | -57% |

### Attempt 1: `_hasHooks` boolean on Inspector object

Added `Inspector._hasHooks` boolean, updated by getter/setter hooks. Result: **still slow**. The issue was that adding getter/setters to the Inspector object changed its V8 hidden class, making ALL property accesses on Inspector more expensive — even `_hasHooks`.

### Attempt 2: Module-level `_inspectorHasHooks` variable

Extracted the boolean to a module-level `let _inspectorHasHooks = false`. Primitives import this directly. V8 treats module-level variables as simple register loads — no property lookup through a complex object.

Hooks reverted to plain properties (no getters/setters). Users call `Inspector.setHooks()` / `clearHooks()` to sync the flag, or `Inspector._syncHooks()` after direct property assignment.

### Final result

| Benchmark | Before | After | Delta |
|---|---|---|---|
| State write (no sub) | 46M | 44.4M | -3% |
| Computed after dep change | 18.1M | 15.3M | -15% |
| Diamond | 6.8M | 6.9M | ~0% |
| Producer emit | 27.3M | 28.5M | noise |
| Operator | 28.1M | 23.5M | -16% |
| Memory/store | 719B | 719B | 0% |

The ~10-15% cost in computed/operator paths is the inherent cost of extra branch points in `_recompute()` and action closures. When hooks are not set (default), V8 short-circuits on `_inspectorHasHooks === false` — a single falsy boolean check with zero function calls.

### Key V8 insight

**Object shape matters.** Adding getter/setters to a plain object literal changes its hidden class and deoptimizes all property accesses on that object. Module-level variables are cheaper than object properties for hot-path guards because V8 can keep them in registers.

---

## Test file: `inspector-usage.test.ts`

Created 10 example tests (9 scenarios) showing Inspector as a real debugging tool:

1. **Diamond tracing** — captures full DIRTY → SETTLED flow through A→B,C→D
2. **RESOLVED subtree skipping** — proves derived skips fn() when value unchanged
3. **Batch coalescing** — verifies derived recomputes once, not twice
4. **dumpGraph() for console/CLI** — readable graph snapshot
5. **Producer lifecycle** — emit, status transitions, completion, error with payload
6. **Operator signal flow** — traces DIRTY → emit → SETTLED through transform
7. **Double diamond full trace** — 6-node graph, every node emits once (glitch-free proof)
8. **Mixed RESOLVED + DATA** — convergence point behavior
9. **Effect debugging** — effect skip on all-RESOLVED deps visible in log

Each test uses a reusable `createInspectorLogger()` helper that captures all hook events into a structured log array, making it easy to filter and assert on specific stores or event types.

---

## Files changed

- `src/core/inspector.ts` — `_inspectorHasHooks`, `setHooks()`, `clearHooks()`, `_syncHooks()`, `dumpGraph()`
- `src/core/state.ts` — hook calls in `set()`
- `src/core/producer.ts` — hook calls in `emit()`, `signal()`, `complete()`, `error()`
- `src/core/derived.ts` — hook calls in `_recompute()`, `_recomputeIdentity()`, `_handleEnd()`, auto-register edges
- `src/core/operator.ts` — hook calls in actions, auto-register edges
- `src/__tests__/core/inspector.test.ts` — expanded from 16 to 28 tests
- `src/__tests__/core/inspector-usage.test.ts` — new, 10 tests demonstrating debugging patterns
- `docs/benchmarks.md` — added "Inspector hooks overhead" section

---

## Honest assessment: hooks vs existing test patterns

After wiring all the hooks and writing the example tests, we audited the entire test suite to see how tests **actually** debug reactive graphs. The finding was stark:

**Inspector is NEVER used in assertions across the entire test suite.** Only `Inspector._reset()` in `beforeEach`.

Every test file uses one of three ad-hoc patterns instead:

| Pattern | Where used | What it captures |
|---|---|---|
| Raw callbag `source(0, cb)` | two-phase.test.ts, edge-cases.test.ts | Exact callbag types (0,1,2,3), signal ordering |
| Computation counters | v4-graph-stress.test.ts | Recompute count in derived `fn()` |
| `observeRaw()` helper | edge-cases.test.ts, tier2 tests | data[], signals[], ended, endError |

### Why hooks don't beat raw patterns for testing

1. **Protocol fidelity** — raw patterns see exact callbag types; hooks abstract them away
2. **DIRTY gap** — derived's DIRTY status is set in the signal handler without a hook call; hooks only fire from `_recompute` (SETTLED/RESOLVED)
3. **Naming tax** — hooks require `{ name: "..." }` on every store; raw patterns work on anonymous stores
4. **Computation counting** — the most common test assertion ("derived computed once") can't be done via hooks at all; you need an inline counter in `fn()`
5. **Glitch detection** — raw patterns capture intermediate values directly; hooks only see final emitted values

### What we added to fix this: `Inspector.observe()`

Instead of trying to make hooks useful for tests, we added `Inspector.observe(store)` — a proper callbag observer that **subsumes the ad-hoc `observeRaw()` pattern** and does it better:

```ts
const obs = Inspector.observe(myDerived);
myState.set(5);

obs.values       // [10] — DATA payloads only
obs.signals      // [DIRTY] — STATE payloads
obs.events       // [{ type: "signal", data: DIRTY }, { type: "data", data: 10 }]
obs.dirtyCount   // 1
obs.resolvedCount // 0
obs.ended        // false
obs.endError     // undefined
obs.name         // "myDerived" (from Inspector registration)
obs.dispose()    // unsubscribe
```

**Why this is better than the ad-hoc pattern:**
- Typed return object vs untyped arrays
- Built-in DIRTY/RESOLVED counting (the most common assertion)
- `events` array preserves protocol order for signal-flow verification
- `name` field integrates with Inspector naming
- `dispose()` for cleanup
- No manual callbag protocol wiring

### Where each tool wins

| Use case | Best tool |
|---|---|
| **Test: "did it recompute once?"** | Inline counter in `fn()` |
| **Test: "what values were emitted?"** | `Inspector.observe(store).values` |
| **Test: "was DIRTY sent before DATA?"** | `Inspector.observe(store).events` |
| **Test: "did RESOLVED skip downstream?"** | `Inspector.observe(store).resolvedCount` |
| **Test: "did it complete/error?"** | `Inspector.observe(store).ended` / `.endError` |
| **Runtime: "what's the graph state?"** | `Inspector.dumpGraph()` / `Inspector.graph()` |
| **Runtime: "log all emits globally"** | `Inspector.setHooks({ onEmit: ... })` |
| **Runtime: "trace one store's changes"** | `Inspector.trace(store, cb)` |

### Final tally

| API | Good for | Not good for |
|---|---|---|
| `observe()` | Test assertions, protocol verification | Runtime monitoring |
| `setHooks()` | Runtime logging, devtools, middleware | Test assertions (too indirect) |
| `dumpGraph()` | Console debugging, CI logs | Assertions (string output) |
| `graph()` | Snapshot assertions, devtools | Hot-path monitoring |

---

## Files changed (final)

- `src/core/inspector.ts` — `_inspectorHasHooks`, `setHooks()`, `clearHooks()`, `_syncHooks()`, `dumpGraph()`, **`observe()`**
- `src/core/state.ts` — hook calls in `set()`
- `src/core/producer.ts` — hook calls in `emit()`, `signal()`, `complete()`, `error()`
- `src/core/derived.ts` — hook calls in `_recompute()`, `_recomputeIdentity()`, `_handleEnd()`, auto-register edges
- `src/core/operator.ts` — hook calls in actions, auto-register edges
- `src/__tests__/core/inspector.test.ts` — expanded from 16 to 28 tests
- `src/__tests__/core/inspector-usage.test.ts` — 16 tests (9 hook examples + 5 observe examples)
- `docs/benchmarks.md` — added "Inspector hooks overhead" section
- `src/archive/docs/SESSION-inspector-hooks-wiring.md` — this file

---

## Blog potential

This session covers:
- **DX story:** "Making reactive debugging actually useful" — from placeholder hooks to working observability
- **Performance story:** Three iterations of optimization, V8 hidden class pitfalls, module-level variables as fast guards
- **Honesty story:** "We built the hooks, then realized they don't beat the existing patterns for testing" — leading to `observe()` as the real DX win
- **Teaching story:** The 16 test examples serve as a tutorial for "how to debug reactive graphs"
- **Architecture story:** Why hooks need to be zero-cost by default in a library that advertises performance parity with Preact Signals
- **Tool design story:** Different debugging APIs serve different audiences (test assertions vs runtime monitoring vs console exploration)

---

## Phase 2: The pivot — hooks removed, Inspector repurposed (v5)

### The decision

After the honest assessment above, we agreed: hooks intrude into production hot paths for marginal benefit. Inspector should be **zero intrusion** — purely a metadata store + callbag sink utilities that AI and humans can plug into flows externally.

### What changed

**Removed from hot paths (state/producer/derived/operator):**
- All `_inspectorHasHooks` boolean checks from emit/signal/complete/error paths
- All `Inspector.onEmit/onSignal/onStatus/onEnd` hook calls
- The `_inspectorHasHooks` module-level variable export

**Removed from Inspector:**
- `onEmit`, `onSignal`, `onStatus`, `onEnd` hook properties
- `setHooks()`, `clearHooks()`, `_syncHooks()` methods

**Converted Inspector from object literal to static class:**
- All methods are now `static` — call `Inspector.observe()`, `Inspector.tap()` etc. without instantiation
- Private static fields for WeakMaps, edges, stores

**Kept (read-only metadata + callbag sinks):**
- `register()`, `registerEdge()` — called from constructors, metadata only
- `inspect()`, `graph()`, `getEdges()`, `dumpGraph()` — read-only queries
- `observe()`, `trace()` — callbag sinks, subscribe externally

**Added (AI-friendly static methods):**
- **`Inspector.tap(store, name?)`** — transparent passthrough wrapper that appears as a distinct graph node. Delegates `get()` and `source()` to the original. Zero overhead.
- **`Inspector.spy(store, opts?)`** — enhanced `observe()` that also logs every event to console. For interactive debugging sessions.
- **`Inspector.snapshot()`** — returns JSON-serializable `{ nodes, edges }` for AI consumption.

### Performance result

Zero regression — hooks are completely gone from hot paths. The 3-16% overhead we measured earlier is now 0%.

### Test conversion: edge-cases.test.ts

Converted `src/__tests__/extra/edge-cases.test.ts` (65 tests) as proof that `Inspector.observe()` fully replaces the ad-hoc `observeRaw()` pattern:
- Deleted the 25-line `observeRaw()` helper function
- Replaced all 36 `observeRaw()` calls with `Inspector.observe()`
- Converted 5 inline `source(START, ...)` patterns to `Inspector.observe()`
- `obs.data` → `obs.values`, `obs.endError` stays the same
- All 65 tests pass unchanged

### Documentation update

Updated `docs/test-guidance.md` with a new "Inspector Debugging Tools" section that covers:
- `observe()`, `tap()`, `spy()`, `snapshot()`, `dumpGraph()`, `trace()`
- "When to use which tool" decision table
- Updated the error forwarding pattern to use `Inspector.observe()` instead of raw sinks

### Files changed (phase 2)

- `src/core/inspector.ts` — converted to static class, removed hooks, added `tap()`, `spy()`, `snapshot()`
- `src/core/state.ts` — removed `_inspectorHasHooks` import and all hook calls
- `src/core/producer.ts` — removed `_inspectorHasHooks` import and all hook calls
- `src/core/derived.ts` — removed `_inspectorHasHooks` import and all hook calls
- `src/core/operator.ts` — removed `_inspectorHasHooks` import and all hook calls
- `src/__tests__/core/inspector.test.ts` — removed hook tests, added tap/spy/snapshot tests
- `src/__tests__/core/inspector-usage.test.ts` — removed hook examples 1-9, kept observe examples, added tap/spy/snapshot/graph examples
- `src/__tests__/extra/edge-cases.test.ts` — converted from `observeRaw()` to `Inspector.observe()`
- `docs/test-guidance.md` — added Inspector Debugging Tools section
