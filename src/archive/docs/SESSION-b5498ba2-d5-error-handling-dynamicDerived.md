# SESSION b5498ba2 — D5 Error Handling + dynamicDerived Primitive

**Date:** March 18, 2026
**Topic:** Add try/catch error handling to derived/dynamicDerived computation functions, introduce dynamicDerived as a new core primitive, adversarial code review + fixes

---

## Key Decisions

### 1. D5: Error handling for derived computation functions

**Problem:** When a user's `fn()` throws inside `_recompute()` or `_lazyConnect()`, the error bubbles up uncontrolled — through `set()` callers, batch handlers, etc. No clean way for subscribers to receive errors.

**Solution:** Dual error semantics based on call context:

- **Push path** (`_recompute`, `_lazyConnect`): wrap `fn()` in try/catch → `_handleEnd(err)` → send `END(error)` to subscribers via callbag protocol
- **Pull path** (`get()` disconnected): let `fn()` throw directly to caller — no state mutation, node remains usable for retry
- **`get()` on ERRORED node**: throw stored error (consistent with pull semantics)

**Error storage:** Reuse `_cachedValue` to store the error when ERRORED. No new field allocation per derived instance. Trade-off: `_cachedValue` has dual semantics (value when healthy, error when ERRORED). Guarded by `_recomputeIdentity` having `D_COMPLETED` bail-out.

**Late subscriber propagation:** `source()` checks ERRORED status → sends `START` + `END(error)` with stored error. Handles the `_lazyConnect` timing issue where output is null when `_handleEnd` fires (sink not yet registered).

**V8 overhead:** Benchmarked at zero measurable overhead (100M calls, <1ns difference). V8 JIT compiles try body as normal code when catch is never entered.

**Rejected:**
- Letting errors bubble up uncontrolled (breaks callbag protocol contract)
- Separate `_error` field on derived (unnecessary allocation for rare case; operator uses `_errorData` because `_value` can be reset by `resetOnTeardown`)
- Only push-path error handling (inconsistent `get()` behavior on ERRORED nodes)

### 2. dynamicDerived — new core primitive

**Problem:** `derived([deps], fn)` requires explicit dep arrays. Some use cases need conditional deps discovered at runtime (e.g., `flag ? get(a) : get(b)`).

**Solution:** `dynamicDerived(fn)` with tracking `get` function. Deps discovered during computation via `_trackGet()` (O(1) dedup via Set). On recompute, `_maybeRewire()` diffs old vs new deps and surgically reconnects.

**Key design choices:**
- Same `DerivedImpl` lifecycle: fully lazy, disconnect-on-unsub, pull-compute when disconnected
- Re-entrancy guard (`D_RECOMPUTING`) prevents signal cycles during rewire
- `D_REWIRING` flag suppresses signals from newly connected deps during rewire
- Tier 1: participates in diamond resolution via bitmask dirty-dep counting
- Error handling identical to derived (try/catch in `_recompute`, `_lazyConnect`, `get()`)
- Tracking state (`_trackingSet`, `_trackedDeps`) cleaned up in catch blocks

### 3. Exception-safe multi-sink END dispatch (D1)

**Problem:** When dispatching `END(error)` to multiple sinks via Set iteration, if one sink throws, remaining sinks never receive END.

**Solution:** Wrap each sink call in try/catch inside the multi-sink loop. Single-sink path doesn't need this (caller handles the throw). Applied to derived, dynamicDerived, and operator (both `complete()` and `error()` actions).

### 4. Operator late subscriber error propagation (D2)

**Problem:** Operator stores error in local closure variable during `error()` action, but doesn't persist it. Late subscriber gets bare `END` without error data.

**Solution:** Added `_errorData: unknown` field to `OperatorImpl`. `error()` action stores error in `this._errorData`. `source()` late subscriber check passes `this._errorData` when ERRORED. Separate field needed because `_value` may be reset by `resetOnTeardown`.

### 5. `_recomputeIdentity` D_COMPLETED guard (D3)

**Problem:** `_recomputeIdentity()` reads `_cachedValue` for equality check. After error, `_cachedValue` holds the error object. Theoretically, `_recomputeIdentity` could compare error-as-value.

**Solution:** Added `if (this._flags & D_COMPLETED) return;` at top of `_recomputeIdentity()`. Currently unreachable (caller callbacks already check D_COMPLETED), but makes the invariant self-documenting for future refactoring safety.

### 6. subscribe.ts get() safety

**Problem:** After P1(a) fix (`get()` throws on ERRORED), `subscribe()` calls `store.get()` at line 74 to capture baseline `prev`. If store errored during `source()` call, `get()` now throws.

**Solution:** Wrapped `store.get()` in try/catch. On error, baseline `prev` is `undefined`. The subscriber already received `END(error)` via the callbag protocol — the `get()` throw is just cleanup noise.

---

## Files Changed

### Core implementation
- `src/core/derived.ts` — try/catch in `_recompute()`, `_lazyConnect()`; error storage in `_handleEnd`; ERRORED check in `source()` and `get()`; `D_COMPLETED` guard in `_recomputeIdentity()`; exception-safe multi-sink END dispatch
- `src/core/dynamicDerived.ts` — **new file**. `DynamicDerivedImpl` class with tracking `get`, `_maybeRewire()`, re-entrancy guard, same error handling as derived
- `src/core/operator.ts` — `_errorData` field; error storage in `error()` action; ERRORED check in `source()` late subscriber; exception-safe multi-sink END dispatch in `complete()` and `error()`
- `src/core/subscribe.ts` — try/catch around `store.get()` baseline capture

### Tests
- `src/__tests__/core/primitives-edge-cases.test.ts` — updated "fn throws" test to expect END(error) instead of throw; added: lazyConnect error, late subscriber error, get() on errored, multi-sink exception safety, late subscriber to errored operator
- `src/__tests__/core/dynamicDerived.test.ts` — **new file**. 20 tests: basic computation, dynamic dep tracking, diamond resolution, equals/memoization, lifecycle (disconnect/reconnect/multi-sub), error handling (push/pull/late subscriber/get-on-errored)

### Docs
- `docs/architecture.md` — added dynamicDerived to node roles, folder hierarchy; updated get() semantics table; added D5 error handling section
- `CLAUDE.md` — added dynamicDerived primitive description; updated file count; added error handling design pattern

---

## Test Results

All **1574 tests pass** across 64 test files. Lint clean (no new warnings).

---

## Behavioral Changes

- **Breaking:** `derived`/`dynamicDerived` `fn()` errors no longer bubble up through `set()` callers. Instead, they're caught and sent as `END(error)` to subscribers. Code that previously caught errors from `state.set()` when a downstream derived threw must now use `onEnd` callbacks.
- **Breaking:** `get()` on an ERRORED derived/dynamicDerived now throws the stored error instead of returning it as the value.
- **New:** Late subscribers to errored derived/dynamicDerived/operator receive `END(error)` with the original error data.
