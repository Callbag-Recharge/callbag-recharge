# Session: createStore Pattern — Zustand-Style Single Store

**Date:** March 17, 2026
**Scope:** New `createStore` pattern, protocol-level `teardown()`, adversarial code review + fixes

---

## Context

Starting from the strategic direction in SESSION-unified-state-management.md, this session implemented the `createStore()` pattern — a Zustand-style single-store API backed by callbag-recharge primitives. The goal: meet the majority of frontend developers where they are (Zustand's `create((set, get) => ...)` ergonomics) while adding callbag-recharge's killer feature — diamond-safe derived selectors with automatic memoization.

## Research: Frontend State Management Landscape

Researched the three dominant patterns:

- **Zustand** (~1KB): `create((set, get) => ({ state + actions }))`. Flat object, shallow merge, no built-in computed/derived. Selectors are just functions re-evaluated on every render — no dependency graph, no memoization, no diamond resolution. Users need `useShallow`, `createSelector`, or manual `useMemo`.
- **Redux Toolkit** (~11KB): `createSlice({ reducers, selectors })`. Separate state/reducer/selector sections, dispatch indirection, immer built-in. More boilerplate.
- **Pinia** (~1.5KB): `defineStore({ state, getters, actions })`. Built-in cached getters (Vue computed). Vue-only.

**Key insight:** Zustand's biggest gap — and callbag-recharge's natural advantage — is computed/derived values. Zustand has no dependency graph, no automatic memoization, no dirty tracking. `select()` backed by `derived()` with diamond resolution and push-phase memoization is architecturally superior.

## Design Decisions

### API Shape
Matched Zustand's `StoreApi<T>` interface (`getState`, `setState`, `getInitialState`, `subscribe`) for middleware compatibility. Added `select()` as the differentiator and `store` property for callbag-recharge composition.

### `select()` — The Killer Feature
Returns a `derived()` store with `Object.is` equality by default. Push-phase memoization means a selector watching `count` doesn't recompute when only `name` changes. No `useShallow`, no `reselect`.

### Two-Phase Initialization
The initializer needs `set`/`get` before the backing `state()` store exists. Solved with a two-phase approach:
- **Phase 1 (init):** `set()`/`get()` operate on a local `initState` variable
- **Phase 2 (post-init):** `set()`/`get()` delegate to `source.get()`/`source.set()`

### Action Preservation on Shallow Merge
Functions in the initial state are detected as "actions" — their keys are cached once at init. On `setState` (shallow merge), action keys not explicitly present in the partial update are preserved from the current state. `replace=true` skips this entirely — true full replacement.

### `teardown()` — Protocol-Level Graph Destruction
Created a new protocol-level utility in `core/protocol.ts`. Works on any store node:
- ProducerImpl/StateImpl/OperatorImpl → calls `.complete()` (sends END to all sinks, cascades)
- DerivedImpl → calls `._handleEnd()` (no public `complete()` on derived nodes)

After teardown, the node is COMPLETED, `_output` is nulled, reference chains are severed enabling GC of the downstream subgraph.

**Difference from `complete()`:** `complete()` is only available on `ProducerStore<T>` (typed). `teardown()` works on any `Store<T>` via duck typing — bridges the gap for `WritableStore<T>` and `DerivedImpl` which don't expose `complete()` in their type signatures.

## Adversarial Code Review

Ran bmad-code-review with Blind Hunter + Edge Case Hunter (no spec → Acceptance Auditor skipped). Found 8 patch issues, 3 defer, 5 rejected as noise.

### Critical Issues Found & Fixed

1. **`set()` during initializer threw ReferenceError** — `source` was `const` declared after initializer. Fixed: `let source = null`, guarded in `set()`.

2. **`get()` during initializer returned `undefined`** — `currentState` uninitialized. Fixed: two-phase `initState` approach, documented behavior.

3. **`replace=true` force-restored actions** — Action preservation loop ran even on replace. Fixed: `replace=true` skips action preservation entirely.

4. **`splitState()` called on every `set()`** — O(keys) per update. Fixed: cache action keys as `string[]` once at init, removed `splitState` helper.

5. **Dual source of truth (`currentState` + `source._value`)** — Internal sync subscription kept them in sync but was fragile. Fixed: removed `currentState` post-init, `get()` reads `source.get()` directly.

6. **No-op updater `set(s => s)` allocated new object** — `Object.assign({}, ...)` always creates new ref. Fixed: early return when `nextPartial === prev && !replace`.

7. **`in` operator matched prototype chain** — `"toString" in obj` is true on any object. Fixed: `Object.hasOwn()`.

8. **`destroy()` only cleaned internal subscription** — Didn't tear down user subscriptions or select()-derived stores. Fixed: `destroy()` calls `teardown(backing)`, which sends END cascading through entire subgraph.

## File Structure

```
src/patterns/
  README.md                        ← Index of all patterns + conventions
  createStore/
    index.ts                       ← Implementation (~160 lines, 945B ESM)
    README.md                      ← Full docs: API, migration guide, examples

src/__tests__/patterns/
  createStore/
    index.test.ts                  ← 31 tests

src/core/protocol.ts               ← Added teardown() utility
src/index.ts                       ← Added teardown export
package.json                       ← Added ./patterns/createStore export
tsup.config.ts                     ← Added entry point
```

## Zustand Middleware — Not Needed

Discussed whether to build a Zustand adapter for plugin compatibility. Decided against it.

**Why Zustand middleware doesn't plug in directly:** Zustand middleware wraps the `StateCreator` function `(set, get, api) => ...` — a three-argument chain composition model. Our `StateCreator` is `(set, get) => T` (no `api` arg). The `StoreApi` shape matches for reading/subscribing, but the middleware composition model is different.

**Why we don't need them:** callbag-recharge's primitives cover the same ground natively:

| Zustand middleware | callbag-recharge equivalent |
|---|---|
| `persist` | `effect([store.store], () => localStorage.setItem(...))` — 2 lines |
| `devtools` | `Inspector.dumpGraph()` / `Inspector.observe()` — built-in, runtime graph, no extension |
| `immer` | Wrap `set` with `produce` in the initializer — 1 line |
| `subscribeWithSelector` | `store.select()` — already better (diamond-safe, memoized) |

A compatibility layer would require matching Zustand's full `StateCreator<T, Mps, Mcs>` generic middleware type signature — complex TypeScript gymnastics for marginal gain.

## Rejected Alternatives

- **Zustand middleware adapter** — Different composition model (`StateCreator` wrapping vs StoreApi shape). Native primitives (`effect`, `Inspector`, `select`) cover all use cases. Not worth the TypeScript complexity.
- **Deep merge instead of shallow** — Matches Zustand behavior. Deep merge is expensive and surprising for arrays. Users should use updater functions for nested state.
- **Implicit tracking (Pinia-style)** — Contradicts explicit deps design principle (see SESSION on pure callbag refactor).
- **Built-in React hook** — Framework-agnostic by design. React bindings are a separate concern.
- **Select deduplication/caching** — `select()` returns a new derived store each call (by design). Users store selectors in variables, same as Zustand. Caching would require WeakMap overhead for a pattern that doesn't need it.

## Post-Review Cleanup

After the code review fixes, simplified the implementation further:
- **Removed `initState` / `initialState` dual variables** — `initialState` is the single mutable variable for both phases. `frozenInitial` captures the snapshot for `getInitialState()`.
- **Removed `backing` / `source` dual names** — `source` is the only name. Starts `null` (phase 1), becomes the `state()` store (phase 2).
- **Documented why `coreSubscribe` over `effect`** — `coreSubscribe` is a lightweight sink (just a callback, no node allocation, no Inspector registration). `effect()` creates a full graph node — unnecessary overhead for "call me when values change."

## Test Coverage

31 tests covering: basic state/actions, setState (merge/replace/updater), getInitialState, subscribe/unsubscribe, select (simple/derived/computation), shallow merge behavior, composition with derived/effect, batching, action preservation, TypeScript inference, async actions, no-op early return, set/get during init, Object.hasOwn safety, destroy cascading END, teardown re-export.

## Outcome

- `createStore` pattern: production-ready, no Zustand adapter needed
- `teardown()`: new protocol-level primitive for graph destruction
- Native equivalents documented for all major Zustand middleware (persist, devtools, immer, subscribeWithSelector)
- Patterns directory convention established for future patterns (memoryStore, etc.)
