# Session f47ed59e — Skip DIRTY, Cached Operator, and Code Review Fixes

**Date:** March 18, 2026
**Session ID:** f47ed59e-6386-4c78-8646-f8b9347dd84d

## Topic

Implementation of 4 optimizations (Skip DIRTY via SINGLE_DEP signaling, reduced bound methods, streamlined DISCONNECTED↔SINGLE transitions, `cached()` operator), followed by adversarial code review and fixes for 3 findings.

## Optimizations Implemented

### 1. Skip DIRTY dispatch via SINGLE_DEP signaling (#18)

When not batching, `state.set()` dispatches DIRTY then immediately DATA — two function calls per subscriber. For single-dep subscribers (derived, effect, operator with one dep), DIRTY is pure overhead: DATA follows synchronously and diamond resolution isn't needed.

**Solution:** Source-side SINGLE_DEP signaling via the callbag talkback reverse channel. Single-dep subscribers send `talkback(STATE, SINGLE_DEP)` after receiving START. The source sets `P_SKIP_DIRTY` (bit 10 in `_flags`). Unbatched `emit()`/`set()` skips DIRTY dispatch when set.

**Dispatch savings:** 50% reduction for single-dep effect, 25-50% for single-dep derived/operator chains.

### 2. Reduced bound methods in ProducerImpl (6→3) (#19)

Constructor now binds only `source` and `emit` (2 instead of 5). StateImpl adds `set`. `signal`, `complete`, `error` provided via lightweight actions wrapper in `_start()` using arrow functions — allocated only when producer starts, GC'd when it stops.

### 3. Streamlined DISCONNECTED↔SINGLE transition (#20)

`DerivedImpl` and `OperatorImpl` reuse `_upstreamTalkbacks` array (`length = 0`) instead of allocating a new one on every reconnect cycle.

### 4. `cached()` operator (extra)

Input-level memoization for expensive derived computations. Two forms:
- **Factory form** — `cached([deps], fn, opts?)`: Like `derived()` but with input-level caching for disconnected `get()`.
- **Pipe form** — `cached(eq?)`: Output dedup + cached getter. Equivalent to `distinctUntilChanged` with cached disconnected reads.

## Code Review Findings and Fixes

Ran `/bmad-code-review` (Blind Hunter + Edge Case Hunter + Acceptance Validator). 3 legitimate findings out of 16:

### P1: Stale P_SKIP_DIRTY on complete()/error()

**Problem:** `complete()` and `error()` cleared `P_MULTI` but not `P_SKIP_DIRTY`. A resubscribable producer could retain the stale flag, skipping DIRTY for a new subscriber that isn't single-dep.

**Fix:** Clear `P_SKIP_DIRTY` and reset `_singleDepCount = 0` in both `complete()` and `error()`.

### P2: Multi-dep cached diamond glitch

**Problem:** `cachedFactory` handler called `fn()` on every DATA without diamond resolution. In a diamond `A→B, A→cached([A,B], fn)`, the cached node would recompute twice — once with stale B, once with fresh B.

**Fix:** Added `Bitmask`-based dirty-dep counting (same pattern as `derived()`/`effect()`). DIRTY sets bits, DATA/RESOLVED clears them, recompute only fires when all dirty deps resolve. `anyDataReceived` flag distinguishes all-RESOLVED (forward RESOLVED) from mixed (recompute).

### D1: P_SKIP_DIRTY not restored on MULTI→SINGLE transition

**Problem:** When a producer goes MULTI→SINGLE (one subscriber disconnects), `P_SKIP_DIRTY` was cleared but never restored — even if the remaining subscriber was single-dep.

**Fix:** Added `_singleDepCount` field to ProducerImpl (8 bytes per store). Each talkback closure tracks a local `isSingleDep` boolean. On SINGLE_DEP signal: increment counter. On talkback END: decrement if was single-dep. On MULTI→SINGLE (Set.size === 1): restore `P_SKIP_DIRTY` if `_singleDepCount > 0`.

**Design decision:** Keeping `_singleDepCount` was debated (8 bytes per store). The performance savings from MULTI→SINGLE restoration outweigh the memory cost. Alternative (drop restoration entirely) was considered but rejected.

## Key Design Decisions

1. **SINGLE_DEP as talkback signal, not constructor option:** Uses the existing callbag reverse channel. No API changes. Subscriber sends it after START; source responds by setting a flag. Clean separation.

2. **P_SKIP_DIRTY and P_MULTI are mutually exclusive:** SINGLE_DEP handler checks `!(P_MULTI)` before setting. SINGLE→MULTI clears P_SKIP_DIRTY. Diamond resolution always has DIRTY.

3. **`_singleDepCount` over alternatives:** Can't query the remaining sink "did you send SINGLE_DEP?" after MULTI→SINGLE. Per-closure tracking with a counter is the simplest correct approach.

4. **cached diamond safety via Bitmask:** Same proven pattern as derived/effect. No novel algorithm needed.

## Files Changed

- `src/core/protocol.ts` — Added `SINGLE_DEP` symbol export
- `src/core/producer.ts` — P_SKIP_DIRTY flag, _singleDepCount, talkback SINGLE_DEP handler, complete/error cleanup
- `src/core/state.ts` — P_SKIP_DIRTY check in unbatched `set()` path
- `src/core/derived.ts` — Send `talkback(STATE, SINGLE_DEP)` for single-dep, synthesize DIRTY on DATA-without-DIRTY
- `src/core/operator.ts` — Send `talkback(STATE, SINGLE_DEP)` for single-dep
- `src/core/effect.ts` — Send `talkback(STATE, SINGLE_DEP)` for single-dep
- `src/extra/cached.ts` — New file: cached operator (factory + pipe forms) with diamond-safe bitmask
- `src/extra/index.ts` — Export cached
- `src/__tests__/core/skip-dirty.test.ts` — 12 tests for SINGLE_DEP signaling + review fix tests
- `src/__tests__/extra/cached.test.ts` — 22 tests for cached operator including diamond safety
- `docs/architecture.md` — Updated §14 with SINGLE_DEP signaling docs
- `docs/optimizations.md` — Updated #18, #6 with review fixes and MULTI→SINGLE restoration

## Test Results

46 test files, 1316 tests passing.
