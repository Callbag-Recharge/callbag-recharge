# Systematic Test & Bug-Fix Plan

Organized into 6 batches, each scoped to fit a single chat session (~40–60 tests + fixes per batch). Work each batch top-to-bottom; earlier batches uncover bugs that later batches depend on.

## Guiding Principles

1. **Verify before fixing.** Every "known bug" listed below is a *hypothesis* based on code reading. Before writing a fix, write a test that exposes the bug. If the test passes — the hypothesis was wrong. Delete the test or adjust expectations. Do not blindly trust this plan.

2. **Existing tests may be wrong.** When a new test contradicts an existing test's expectation, read the source code to determine which is correct. The source is the authority — update whichever test has the wrong expectation. Prior test authors (including Claude) may have encoded wrong assumptions about rxjs semantics or library-specific design choices.

3. **Design choices ≠ bugs.** Some behaviors flagged below may be intentional divergences from rxjs. For example:
   - `share()` is a no-op because stores are inherently multicast — not a bug.
   - `fromPromise` swallowing rejections — fixed in batch 2 to forward rejections as errors.
   - `fromObs` omitting `error`/`complete` from the observer — fixed in batch 2 to forward both.

   When in doubt, write the test, see what happens, and discuss with the code owner before "fixing."

4. **Test what the code *should* do, not what it *does*.** Write tests expressing the correct semantic (e.g., "upstream error should propagate"). If the test fails, that's a real bug. If it passes, great — the code was already correct.

5. **One batch per chat.** Each batch is sized for a single conversation (~40–60 tests). Don't rush to the next batch — fix all issues in the current batch before moving on.

---

## Batch 1 — Untested Operators: first, last, find, elementAt, partition ✅ DONE

**Goal:** These operators have zero dedicated tests. Write comprehensive tests and fix bugs found.

**Result:** 42 tests written, 3 bugs fixed. All 514 tests passing.

**Test file:** `src/__tests__/extras/selection-operators.test.ts`

### Bugs Found & Fixed

| Operator | Hypothesis | Result | Fix |
|----------|-----------|--------|-----|
| `first` | Upstream error → `complete()` instead of `error()` | ✅ Confirmed | END handler now checks `data !== undefined` → `error(data)` |
| `find` | Same as first — upstream error swallowed | ✅ Confirmed | Same fix |
| `elementAt` | Same as first — upstream error swallowed | ✅ Confirmed | Same fix |

`last` was already correct as predicted — checks `data !== undefined` and calls `error(data)`. Verified with tests.

`partition` had no bugs. All 10 tests passed on first run.

### Tests Written

**first (8 tests)** ✅
- Emits first DATA then completes
- get() returns undefined before first DATA, then captured value
- Upstream error is forwarded (not converted to completion) ← bug fixed
- Upstream completes before emitting → clean complete with no DATA
- Disconnects upstream after first value (no further DATA)
- Works in pipe chain: `pipe(source, first())`
- Late subscriber after completion gets END immediately
- get() retains value after completion

**last (8 tests)** ✅
- Buffers all values, emits last on upstream completion
- get() returns undefined before completion, then last value
- Upstream error → forwards error, does NOT emit buffered value
- Empty upstream (completes with no DATA) → complete with no emission
- Multiple values → only last emitted
- Works with fromIter (synchronous completion)
- Late subscriber after completion gets END immediately
- get() retains last value after completion

**find (8 tests)** ✅
- Emits first matching value then completes
- get() returns undefined until match, then matched value
- No match → complete on upstream END with no emission
- Upstream error before match → forward error ← bug fixed
- Predicate receives correct value
- Disconnects upstream after match
- Works in pipe chain with state source
- Late subscriber after completion gets END immediately

**elementAt (8 tests)** ✅
- Emits value at given index (0-based)
- Index 0 → same as first()
- Index beyond stream length → complete on upstream END
- Upstream error before reaching index → forward error ← bug fixed
- get() returns undefined until target index
- Negative index → never emits, complete on END
- Count tracks only DATA emissions (not STATE)
- Late subscriber after completion gets END immediately

**partition (10 tests)** ✅
- Splits values by predicate into [true, false] stores
- Both branches share single upstream subscription (refcounted)
- Unsubscribe one branch keeps other alive
- Unsubscribe both branches disconnects upstream
- Matching branch gets DATA, non-matching gets RESOLVED
- Error propagated to both branches
- Completion propagated to both branches
- Late subscriber after completion gets END immediately
- get() returns last value for each branch
- Works with state source and dynamic values

**Actual: 42 tests, 3 bug fixes**

---

## Batch 2 — Tier-1 Sources & buffer: Error/Completion Correctness ✅ DONE

**Goal:** Verify error/completion semantics for all source factories and fix `buffer` + `fromPromise` + `fromObs` bugs.

**Result:** 31 new tests written (gap tests only — basics already covered in existing files). 3 sources fixed (fromPromise, fromObs, buffer), 545 total tests passing.

**Test file:** `src/__tests__/extras/sources.test.ts`

### Bugs Found & Fixed

| Module | Hypothesis | Result | Fix |
|--------|-----------|--------|-----|
| `buffer` | Missing `onEnd` on input subscription — upstream error/completion ignored | ✅ Confirmed | Added `onEnd` handler to input `subscribe()` — forwards error or flushes+completes |
| `buffer` | Missing error/completion handling on notifier END | ✅ Confirmed | END handler now checks `data` for error, otherwise flushes+completes |
| `fromPromise` | Rejection silently swallowed (`() => {}`) | ✅ Confirmed — was a bug | Rejection handler now calls `error(reason)` instead of `() => {}` |
| `fromObs` | Missing `error`/`complete` in observable observer | ✅ Confirmed | Observer now passes `{ next, error, complete }` — errors and completion forwarded to producer |

### Additional findings

- **fromIter**: Iterator that throws → exception bubbles up uncaught (producer doesn't wrap init in try/catch). Documented in test.
- **empty/never in switchMap**: switchMap emits `undefined` (inner.get()) on switch — expected behavior, not a bug.
- **fromEvent**: Uses producer (multicast), so multiple subscribers share a single listener. Documented.
- **interval**: Reconnect resets counter to 0 (producer re-runs init). Documented.

### Tests Written (gap tests — new coverage beyond existing)

**fromIter (5 tests)** ✅
- Completes after emitting all values
- Empty iterable → immediate completion
- Iterator that throws → exception bubbles up
- Multiple subscribers (second gets END — producer completed)
- Late subscriber after completion gets END immediately

**fromPromise (6 tests)** ✅
- Resolved promise → emit value then complete
- Rejected promise → forward error ← bug fixed
- get() returns undefined before resolution
- Multiple subscribers to same fromPromise
- Already-resolved promise → still emits (microtask)
- Unsubscribe before resolution → no emission

**fromObs (5 tests)** ✅
- Observable error → forward error ← bug fixed
- Observable complete → forward completion ← bug fixed
- Multiple next() calls → multiple emissions
- get() returns last emitted value
- Unsubscribe calls observable unsubscribe

**fromEvent (3 tests)** ✅
- Multiple subscribers → share single listener (producer multicast)
- get() returns last event
- Reconnect re-adds listener

**interval (3 tests)** ✅
- get() returns last counter value
- Reconnect resets counter to 0
- Multiple subscribers share single timer

**of / empty / throwError / never (4 tests)** ✅
- of: works as inner source in switchMap
- empty: works as inner source in switchMap (emits undefined)
- throwError: works as inner source in switchMap — propagates error
- never: works as inner source in switchMap (emits undefined)

**buffer (5 tests)** ✅
- Upstream error → forward error, stop buffering ← bug fixed
- Upstream completion → flush remaining buffer, then complete ← bug fixed
- Notifier error → forward error ← bug fixed
- Notifier completion → flush remaining buffer, then complete ← bug fixed
- Cleanup releases both subscriptions

**Actual: 31 new tests, 3 source fixes (fromPromise, fromObs, buffer)**

---

## Batch 3 — Core Primitives Edge Cases

**Goal:** Stress-test producer, state, derived, effect, and operator for exception handling, lifecycle edge cases, and reentrancy.

### Tests to Write

**producer (~10 tests)**
- emit() after error() is no-op (producer is completed)
- emit() after complete() is no-op
- Multiple complete() calls are idempotent
- Multiple error() calls — only first takes effect
- Cleanup function called exactly once on last sink disconnect
- Cleanup function called on error/complete
- resetOnTeardown: get() returns initial after disconnect
- getter option: custom get() used when disconnected
- equals option: equal values suppress emission
- Late subscriber to completed producer gets END with error payload

**state (~8 tests)**
- set() during subscriber callback (reentrancy)
- update() fn sees current value
- Object.is: NaN === NaN (suppressed), +0 !== -0 (emitted)
- set() with same value → no emission (Object.is dedup)
- Many rapid set() calls → each emits (no batching without batch())
- set() on completed state → should this work or throw?
- get() always returns latest even without subscribers
- Custom equals option overrides Object.is

**derived (~12 tests)**
- fn throws exception → what happens to subscribers?
- fn calls get() on a dep that also threw → cascading error behavior
- Circular dependency detection (if any)
- get() during fn execution (dep reads itself)
- Very deep chain (10 nested deriveds) → correct propagation
- 5-branch diamond → single recomputation
- derived of derived of derived → DIRTY counting correct
- equals option: derived suppresses emission when fn returns same value
- Upstream error propagation through derived chain
- Upstream completion propagation through derived chain
- Cache invalidation: get() without subscribers recomputes
- Derived with single dep (no diamond) → simple passthrough

**effect (~10 tests)**
- fn throws exception → what happens? (effect dies? error propagated?)
- Cleanup fn throws exception → next execution still runs?
- dispose() during execution → cleanup runs, no re-run
- dispose() called twice → idempotent
- Nested effects: effect A triggers state change → effect B runs
- Effect with 5+ deps → fires once per batch, not per dep
- Effect with completed upstream dep → does it dispose?
- Effect within batch() → deferred until batch ends
- Effect cleanup ordering (cleanup before re-run guarantee)
- Effect sees consistent state (all deps resolved before fn runs)

**operator (~8 tests)**
- Handler called after complete() → no-op
- disconnect() called twice on same dep → idempotent
- disconnect() one dep while others still active
- get() after completion → returns last cached value
- seed() during init sets value without DATA emission
- Multiple sinks: one unsubscribes → other still receives
- Reconnect: does init re-run?
- Error during handler → propagation behavior

**Estimated: ~48 tests**

---

## Batch 4 — Reconnect & Lifecycle Across All Operators

**Goal:** Systematically test disconnect→reconnect for every stateful operator. Ensure state resets correctly, timers restart, counters reset.

### Tests to Write

For each operator, the pattern is: subscribe → receive values → unsub → re-subscribe → verify fresh state.

**Tier 1 operators (~15 tests)**
- take: counter resets on reconnect
- skip: counter resets on reconnect
- first: done flag resets on reconnect
- find: done flag resets on reconnect
- elementAt: counter resets on reconnect
- pairwise: prev buffer resets on reconnect
- scan: accumulator resets to seed on reconnect
- distinctUntilChanged: cached value resets on reconnect
- map/filter: stateless, but verify reconnect works
- merge: all sources re-subscribed
- combine: all sources re-subscribed, waiting for all
- concat: starts from first source again
- partition: both branches re-subscribe

**Tier 2 operators (~12 tests)**
- debounce: timer state cleared on reconnect
- throttle: timer state cleared on reconnect
- delay: no pending timers on reconnect
- bufferTime: buffer empty, timer restarted on reconnect
- timeout: timer restarted on reconnect
- sample: latest value cleared on reconnect
- switchMap: no active inner on reconnect
- concatMap: queue empty on reconnect
- exhaustMap: not locked on reconnect
- flat: no active inner on reconnect
- retry: retry count reset on reconnect
- rescue: not in fallback state on reconnect

**Core primitives (~5 tests)**
- producer: cleanup called, fresh init on reconnect
- derived: cache invalidated, recomputes on reconnect
- effect: cleanup called, re-runs on reconnect (effect doesn't "reconnect" — it's dispose+create)
- operator: init re-runs on reconnect
- state: reconnect is transparent (state persists)

**Estimated: ~32 tests**

---

## Batch 5 — Reentrancy, Stress, and Complex Chains

**Goal:** Test dangerous scenarios: mutations during callbacks, rapid subscription churn, deeply nested operator chains, mixed tier-1/tier-2 pipelines.

### Tests to Write

**Reentrancy (~10 tests)**
- State set() inside subscribe callback → correct ordering
- State set() inside derived fn → ? (should this be disallowed?)
- State set() inside effect → triggers new cycle
- Unsubscribe self inside subscribe callback → safe
- Subscribe new sink inside subscribe callback → receives current emission
- complete() inside emit handler → ordering
- error() inside emit handler → ordering
- switchMap: outer emits during inner subscribe → clean switch
- concatMap: outer emits during inner complete → queued correctly
- batch() inside subscribe callback → nested batch

**Complex chains (~8 tests)**
- pipe(state, map, filter, scan, take) → 5-operator chain
- pipe(state, debounce, switchMap, map, subscribe) → mixed tier chain
- derived → pipe(map) → derived → effect → diamond-safe?
- merge(pipe(a, map), pipe(a, filter)) → diamond through merge
- concat(fromIter([1,2,3]), of(4), empty()) → sequential completion
- switchMap returning pipe(inner, debounce, take(1)) → nested async
- retry(3) wrapping pipe(source, map, take(5)) → retry with limiting
- rescue wrapping rescue → double fallback

**Rapid churn (~6 tests)**
- 100 subscribe/unsubscribe cycles → no leaked subscriptions
- Rapid state.set() 1000 times → all values delivered (or batched)
- switchMap with 100 rapid outer emissions → only last inner active
- interval + take(1000) → all 1000 values delivered, then clean complete
- Many effects (50+) on same dep → all fire once per change
- combine with 20 sources → correct tuple on each change

**Memory safety (~5 tests)**
- Completed producer releases all sink references
- Unsubscribed chain releases all intermediate stores (GC-friendly)
- Error'd producer doesn't retain error handler references
- Large buffer (10000 items) in bufferTime → flushed correctly
- concatMap with long queue (100 items) → processed in order

**Estimated: ~29 tests**

---

## Batch 6 — Protocol-Level, Batch Interaction, and Interop

**Goal:** Test the callbag protocol layer, batch() edge cases, connection deferral, and external library interop.

### Tests to Write

**Type 3 STATE protocol (~8 tests)**
- Raw callbag source (no type 3) feeding into derived → still works
- Double DIRTY without intervening RESOLVED → derived handles correctly
- RESOLVED without preceding DIRTY → no-op
- DIRTY on completed store → ignored
- Type 3 signal not forwarded to tier-2 boundary correctly → verify
- Custom operator emitting DIRTY manually → downstream reacts
- DIRTY propagation stopped by take after completion
- Multiple RESOLVED in a row → no spurious emissions

**batch() interaction (~10 tests)**
- batch() defers emissions but DIRTY flows immediately
- Nested batch() → only outermost flush triggers emissions
- batch() with error inside → error delivered after batch
- batch() with complete inside → complete delivered after batch
- effect inside batch → deferred until batch ends
- derived recomputation during batch → only final value
- batch + switchMap → inner emission deferred
- batch + debounce → timer starts after batch ends?
- Empty batch (no state changes) → no emissions
- batch during another store's subscriber callback

**Connection deferral (beginDeferredStart/endDeferredStart) (~5 tests)**
- Producer start deferred until endDeferredStart
- Multiple deferred producers → all start at endDeferredStart
- Nested deferral → only outermost triggers starts
- Deferred start with immediate error → error after start
- concat uses deferral correctly for sequential sources

**External interop (~5 tests)**
- callbag-recharge source consumed by raw callbag sink
- Raw callbag source consumed by callbag-recharge subscribe
- fromObs with rxjs-like Observable (next/error/complete)
- Store used as observable (Symbol.observable or .subscribe)
- pipe() compatibility with external callbag operators

**Estimated: ~28 tests**

---

## Summary

| Batch | Focus | Tests | Suspected Fixes | Priority |
|-------|-------|-------|-----------------|----------|
| 1 | Untested operators (first/last/find/elementAt/partition) | ~42 | 3 | Critical |
| 2 | Source factories + buffer error/completion | ~47 | 4 | Critical |
| 3 | Core primitives edge cases | ~48 | TBD | High |
| 4 | Reconnect/lifecycle across all operators | ~32 | TBD | High |
| 5 | Reentrancy, stress, complex chains | ~29 | TBD | Medium |
| 6 | Protocol, batch, interop | ~28 | TBD | Medium |
| **Total** | | **~226** | **7+ suspected** | |

All "fix" counts are hypotheses. Write the test first — if it passes, the code is correct and no fix is needed. Batches 3–6 will likely uncover additional issues during testing. Existing tests that conflict with new findings should be re-evaluated against the source code.

## Test File Strategy

- **Batch 1** → `src/__tests__/extras/selection-operators.test.ts` (first/last/find/elementAt/partition)
- **Batch 2** → `src/__tests__/extras/sources.test.ts` (fromIter/fromPromise/fromObs/fromEvent/interval/of/empty/throwError/never/buffer)
- **Batch 3** → `src/__tests__/core/primitives-edge-cases.test.ts`
- **Batch 4** → `src/__tests__/extras/reconnect.test.ts`
- **Batch 5** → `src/__tests__/extras/stress.test.ts`
- **Batch 6** → `src/__tests__/core/protocol-edge-cases.test.ts`
