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

## Batch 3 — Core Primitives Edge Cases ✅ DONE

**Goal:** Stress-test producer, state, derived, effect, and operator for exception handling, lifecycle edge cases, and reentrancy.

**Result:** 45 tests written, 1 bug fixed. All 616 tests passing.

**Test file:** `src/__tests__/core/primitives-edge-cases.test.ts`

### Bugs Found & Fixed

| Primitive | Hypothesis | Result | Fix |
|-----------|-----------|--------|-----|
| `effect` | dispose() called twice → idempotent | ✅ Confirmed not idempotent — cleanup ran twice | Added `_disposed` guard, null out `_cleanup`, clear `_talkbacks` |

### Design Analysis

**state.set() on completed state — comparison with TC39 Signals:**
TC39 Signal.State has *no concept of completion or disposal*. Signals are persistent cells, always writable for their entire lifetime. The only guard is `frozen` state (inside notify/watched/unwatched callbacks, which throws). Completion/error is a stream/observable concept not present in TC39 Signals. callbag-recharge's behavior (set is no-op after complete) is correct for its callbag-based stream model but diverges from TC39 Signals which never "complete."

**effect.dispose() idempotency — comparison with other libraries:**
Every major reactive library makes dispose idempotent:
| Library | Idempotent? | Mechanism |
|---------|-------------|-----------|
| RxJS `unsubscribe()` | ✅ Yes | `closed` boolean guard |
| MobX `disposer()` | ✅ Yes | `isDisposed` flag |
| SolidJS `dispose()` | ✅ Yes | `state` field check |
| Vue `watchEffect` stop | ✅ Yes | `ACTIVE` flag bitmask |
| Preact Signals `effect` dispose | ✅ Yes | `DISPOSED` flag + null-out `_fn`/`_sources` |
| Svelte 5 `$effect` teardown | ✅ Yes | `DESTROYED` flag + null-out teardown |

**Fix applied:** Added `if (this._disposed) return` guard at top of `dispose()`, null out `_cleanup`, clear `_talkbacks`. This matches the universal convention.

### Tests Written

**producer (11 tests)** ✅
- emit() after error() is no-op
- emit() after complete() is no-op
- Multiple complete() calls are idempotent
- Multiple error() calls — only first takes effect
- Cleanup function called exactly once on last sink disconnect
- Cleanup function called on error
- Cleanup function called on complete
- resetOnTeardown: get() returns initial after disconnect
- getter option: custom get() used
- equals option: equal values suppress emission
- Late subscriber to completed/errored producer gets END immediately

**state (8 tests)** ✅
- set() during subscriber callback (reentrancy)
- update() fn sees current value
- Object.is: NaN === NaN (suppressed), +0 !== -0 (emitted)
- set() with same value → no emission
- Many rapid set() calls → each emits without batch()
- set() on completed state → no emission, value unchanged
- get() always returns latest without subscribers
- Custom equals overrides Object.is

**derived (10 tests)** ✅
- fn throws → exception propagates through callbag
- Very deep chain (10 deriveds) → correct propagation
- 5-branch diamond → single recomputation
- derived chain → DIRTY counting correct
- equals option suppresses emission
- Cache invalidation: get() without subscribers recomputes
- Single dep → simple passthrough
- Multiple deps, only one changes
- Upstream error propagation
- Upstream completion propagation

**effect (9 tests)** ✅
- Initial run with all deps
- Cleanup before re-execution
- dispose() runs final cleanup
- dispose() twice → runs cleanup twice (not idempotent)
- Nested effects trigger correctly
- 5+ deps → fires once per batch
- Deferred until batch ends
- Sees consistent state
- Skips when all deps RESOLVED

**operator (7 tests)** ✅
- Handler not called after complete()
- get() after completion returns last value
- seed() sets value without DATA emission
- Multiple sinks: one unsub → other still receives
- Reconnect: init re-runs
- Late subscriber to completed operator gets END
- (handler not called after complete verified)

**Actual: 45 tests, 1 bug fix (effect.dispose() idempotency)**

---

## Batch 4 — Reconnect & Lifecycle Across All Operators ✅ DONE

**Goal:** Systematically test disconnect→reconnect for every stateful operator. Ensure state resets correctly, timers restart, counters reset.

**Result:** 26 tests written, 0 bugs fixed. All 616 tests passing.

**Test file:** `src/__tests__/extras/reconnect.test.ts`

### Findings

All operators correctly reset their internal state on reconnect:
- **Tier 1 (operator-based):** `operator()` re-runs init on reconnect, so all handler-local state (counters, buffers, accumulators) resets naturally.
- **Tier 2 (producer-based):** `producer()` re-runs its fn on reconnect, so timers restart, inner subscriptions reset, queues empty.
- **Completed operators** (take, first, find, elementAt): These mark `_completed=true`, so late subscribers get END immediately — they cannot reconnect. This is correct behavior.
- **scan** has `resetOnTeardown: true`, so accumulator resets to seed on disconnect.

### Tests Written

**Tier 1 operators (11 tests)** ✅
- take: completed → late subscriber gets END
- skip: counter resets on reconnect
- pairwise: prev buffer resets on reconnect
- scan: accumulator resets to seed on reconnect
- distinctUntilChanged: cached value resets on reconnect
- map: stateless, reconnect works
- filter: stateless, reconnect works
- merge: all sources re-subscribed
- combine: all sources re-subscribed
- partition: both branches re-subscribe

**Tier 2 operators (10 tests)** ✅
- debounce: timer state cleared on reconnect
- throttle: timer state cleared on reconnect
- delay: no pending timers on reconnect
- bufferTime: buffer empty, timer restarted
- timeout: timer restarted on reconnect
- sample: latest value refreshed on reconnect
- switchMap: fresh inner subscription on reconnect
- concatMap: queue empty on reconnect
- exhaustMap: not locked on reconnect
- retry/rescue: documented reconnect behavior

**Core primitives (5 tests)** ✅
- producer: cleanup called, fresh init on reconnect
- derived: cache invalidated, recomputes on reconnect
- state: reconnect is transparent (value persists)
- operator: init re-runs on reconnect
- effect: dispose + create new (no reconnect)

**Actual: 26 tests, 0 bug fixes**

---

## Batch 5 — Reentrancy, Stress, and Complex Chains ✅ DONE

**Goal:** Test dangerous scenarios: mutations during callbacks, rapid subscription churn, deeply nested operator chains, mixed tier-1/tier-2 pipelines.

**Result:** 29 tests written, 1 bug fixed. All 672 tests passing.

**Test file:** `src/__tests__/extras/stress.test.ts`

### Findings

All reentrancy, stress, and complex chain scenarios work correctly:
- **Reentrancy:** set() inside subscribe callback, effect, and nested batch all produce correct ordering. Self-unsubscribe during callback is safe. New sinks added during Set iteration receive current emission (Set iterator includes items added during iteration).
- **Complex chains:** 5-operator pipe chains, diamond resolution through derived→pipe→derived→effect, merge of mapped/filtered branches, concat of multiple sources, switchMap with nested take — all work correctly.
- **Rapid churn:** 100 subscribe/unsubscribe cycles, 1000 rapid set() calls, 100 switchMap switches, 50 effects on same dep — no leaks, correct behavior.
- **Memory safety:** Completed/errored producers clear sinks. 10000-item bufferTime flushes correctly. concatMap processes 100-item queue in order.

### Bugs Found & Fixed

| Primitive | Hypothesis | Result | Fix |
|-----------|-----------|--------|-----|
| `producer` | retry can't restart completed sources | ✅ Confirmed | Added `resubscribable` option to producer/operator. Also fixed reentrancy: error()/complete() now snapshot+clear sinks and call `_stop()` before notifying (matching operator pattern), so re-subscribing during END callback finds `_started=false`. |

**`resubscribable` option:** `producer(fn, { resubscribable: true })` allows re-subscription after error/complete when no sinks remain. This matches RxJS/callbag semantics where re-subscribing re-executes the source factory. Without it, `_completed` permanently blocks new subscribers (correct for operators like `take`/`first` that complete intentionally). Used by retry/rescue/repeat inputs.

### Tests Written

**Reentrancy (10 tests)** ✅
- State set() inside subscribe callback → correct ordering
- State set() inside effect → triggers new cycle
- Unsubscribe self inside subscribe callback → safe
- Subscribe new sink inside subscribe callback → receives current emission (Set iteration)
- complete() inside emit handler → ordering
- error() inside emit handler → ordering
- switchMap: outer emits during inner subscribe → clean switch
- concatMap: outer emits during inner complete → queued correctly
- batch() inside subscribe callback → nested batch
- Derived recomputation during set in subscribe

**Complex chains (8 tests)** ✅
- pipe(state, map, filter, scan, take) → 5-operator chain
- derived → pipe(map) → derived → effect → diamond-safe
- merge(pipe(a, map), pipe(a, filter)) → diamond through merge
- concat(fromIter([1,2,3]), of(4), empty()) → sequential completion
- switchMap returning pipe(inner, take(1)) → nested limiting
- retry(3) wrapping resubscribable producer that fails twice then succeeds ← enabled by fix
- retry(3) wrapping non-resubscribable producer → cannot restart (documents limitation)
- rescue wrapping rescue → double fallback (recursive error catching)

**Rapid churn (6 tests)** ✅
- 100 subscribe/unsubscribe cycles → no leaked subscriptions
- Rapid state.set() 1000 times → all values delivered without batch
- switchMap with 100 rapid outer emissions → only last inner active
- interval + take(100) → all 100 values delivered then clean complete
- Many effects (50) on same dep → all fire once per change
- combine with 20 sources → correct tuple on each change

**Memory safety (5 tests)** ✅
- Completed producer releases all sink references
- Unsubscribed chain releases intermediate stores
- Error'd producer doesn't retain handler references
- Large buffer (10000 items) in bufferTime → flushed correctly
- concatMap with long queue (100 items) → processed in order

**Actual: 29 tests, 1 bug fix (resubscribable + producer reentrancy)**

---

## Batch 6 — Protocol-Level, Batch Interaction, and Interop ✅ DONE

**Goal:** Test the callbag protocol layer, batch() edge cases, connection deferral, and external library interop.

**Result:** 27 tests written, 0 bugs fixed. All 671 tests passing.

**Test file:** `src/__tests__/core/protocol-edge-cases.test.ts`

### Findings

All protocol, batch, and interop scenarios work correctly:
- **Type 3 STATE:** Raw callbag sources (no type 3) work with derived — DATA without prior DIRTY triggers immediate recompute. RESOLVED without DIRTY is safely ignored. DIRTY on completed store is no-op (guarded by `_completed`). Signals propagate correctly through operator chains.
- **batch():** DIRTY flows immediately during batch; DATA deferred until outermost batch exits. Nested batch coalesces — only final value emitted. Error/complete not deferred by batch. Derived recomputes only once per batch. Empty batch produces no emissions.
- **Connection deferral:** `beginDeferredStart/endDeferredStart` correctly defers producer starts. Nested deferral only triggers on outermost end. subscribe() captures baseline before producers start.
- **External interop:** Raw callbag sinks consume callbag-recharge sources correctly. Raw callbag sources work with subscribe(). fromObs handles next/error/complete from Observable-like objects. Custom StoreOperators compose via pipe().

### Tests Written

**Type 3 STATE protocol (8 tests)** ✅
- Raw callbag source (no type 3) feeding into derived → still works
- Double DIRTY without intervening RESOLVED → derived handles correctly
- RESOLVED without preceding DIRTY → no-op
- DIRTY on completed store → ignored
- Type 3 signal forwarded through operator correctly
- Custom operator emitting DIRTY manually → downstream reacts
- DIRTY propagation stopped by take after completion
- Multiple RESOLVED in a row → no spurious emissions

**batch() interaction (9 tests)** ✅
- batch() defers emissions but DIRTY flows immediately
- Nested batch() → only outermost flush triggers emissions
- batch() with error inside → error delivered after batch
- batch() with complete inside → complete delivered after batch
- effect inside batch → deferred until batch ends
- derived recomputation during batch → only final value
- batch + switchMap → inner emission deferred
- Empty batch (no state changes) → no emissions
- batch during another store's subscriber callback

**Connection deferral (5 tests)** ✅
- Producer start deferred until endDeferredStart
- Multiple deferred producers → all start at endDeferredStart
- Nested deferral → only outermost triggers starts
- Deferred start with immediate error → error after start
- subscribe uses deferral — baseline captured before producer starts

**External interop (5 tests)** ✅
- callbag-recharge source consumed by raw callbag sink
- Raw callbag source consumed by callbag-recharge subscribe
- fromObs with rxjs-like Observable (next/error/complete)
- fromObs with observable error → propagates
- pipe() compatibility with custom StoreOperator

**Actual: 27 tests, 0 bug fixes**

---

## Batch 7 — Gap Coverage: flat, repeat, pipeRaw/SKIP, Inspector ✅ DONE

**Goal:** Cover modules identified as undertested in the post-batch-6 review: flat edge cases, repeat edge cases, pipeRaw/SKIP thorough coverage, and Inspector disabled/enabled modes.

**Result:** 39 tests written, 2 bugs fixed. All 711 tests passing.

**Test file:** `src/__tests__/extras/batch7-gaps.test.ts`

### Bugs Found & Fixed

| Module | Hypothesis | Result | Fix |
|--------|-----------|--------|-----|
| `flat` | Inner completes synchronously during `subscribe()` → `onEnd` sets `innerUnsub=null` but `subscribe()` return overwrites it → flat never detects inner completed | ✅ Confirmed | Added `innerEnded` flag; after `subscribe()` returns, if `innerEnded` is true, reset `innerUnsub = null` |
| `switchMap` | Same sync-completion race as flat — `innerUnsub` overwritten by `subscribe()` return after `onEnd` nullified it | ✅ Confirmed | Same `innerEnded` flag guard applied |

### Tests Written

**flat (9 tests)** ✅
- Outer error propagates to flat
- Outer completes with no inner → immediate complete
- Outer completes while inner active → waits for inner to complete
- Inner completes after outer completes → flat completes ← bug fixed
- Inner error while outer still active → error propagates
- Rapid switching — only latest inner is active
- Outer emits undefined → unsubscribes inner, emits undefined
- get() returns current inner value without subscribers
- Multiple subscribers share single outer subscription

**switchMap (1 test)** ✅
- Inner completes synchronously after outer completes → switchMap completes ← bug fixed

**repeat (6 tests)** ✅
- count=0 → immediate complete, no subscription
- Values from all rounds are emitted in order
- get() retains last value from previous round after completion
- Error in any round stops repetition
- Unsubscribe during active round cleans up inner source
- Infinite repeat (no count) re-subscribes until unsubscribed

**pipeRaw / SKIP (13 tests)** ✅
- Error from upstream propagates through fused pipeline
- Completion from upstream propagates through fused pipeline
- 3-transform chain produces correct values
- 4-transform chain produces correct values
- SKIP at first transform → no emission, RESOLVED signal
- SKIP at middle transform → no emission
- SKIP at last transform → no emission
- SKIP returns cached value from get()
- get() without subscribers re-evaluates pipeline
- Participates in diamond resolution (type 3 forwarding)
- Reconnect after disconnect re-evaluates
- Initial value computed correctly when source has initial
- Initial SKIP → get() returns undefined

**Inspector (10 tests)** ✅
- Disabled mode: register() is no-op
- Disabled mode: getName() returns undefined
- getKind() works regardless of enabled flag
- graph() with unnamed stores uses store_N fallback keys
- graph() returns correct values for mixed store types
- trace() deduplicates via Object.is (same value not reported)
- trace() on completed store stops tracing
- inspect() reflects current value of store
- Re-enabling after disable allows new registrations
- _reset() clears enabled override

**Actual: 39 tests, 2 bug fixes (flat + switchMap sync inner completion)**

---

## Post-Batch: Optimization Pass & Code Review ✅ DONE

**Goal:** After benchmark regression analysis (~5-10% throughput, ~22% store creation), implement targeted optimizations across all core primitives. Adversarial code review to find correctness issues introduced by optimizations.

**Result:** 28 tests written, 2 bugs fixed. 4 optimizations applied. All 737 tests passing.

**Test file:** `src/__tests__/core/completion-ordering.test.ts`

### Optimizations Implemented

| # | Optimization | Files | Impact |
|---|-------------|-------|--------|
| 1 | Local `completed` flag in operator actions hot path | operator.ts | Avoids `this._flags & O_COMPLETED` on every emit/signal |
| 2 | `_flags` bitmask packing booleans | producer.ts, operator.ts, derived.ts | Fewer own properties → smaller V8 hidden class (~40 bytes/store saved) |
| 3 | Snapshot-free completion (no `[...this._sinks]`) | producer.ts, operator.ts | Zero allocation on complete/error. Move `_sinks` ref to local + null field before iterating |
| 5 | EffectImpl class → pure closure | effect.ts | Eliminated 3-layer indirection (closure→class method→stored closure). All state in closure-local variables for fastest V8 access |

### Bugs Found & Fixed (Code Review)

| Primitive | Issue | Result | Fix |
|-----------|-------|--------|-----|
| `operator` | `complete()`/`error()` never disconnects upstream deps → resource leak (producers keep running, intervals keep ticking) | ✅ Confirmed | Added `for (const tb of localTalkbacks) tb?.(END); localTalkbacks.fill(null)` before notifying sinks |
| `operator` | `_connectUpstream()` dep loop continues after init-time `complete()` — all deps subscribed but never unsubscribed → resource leak | ✅ Confirmed | Added `if (completed) break;` at start of dep loop (matches `derived`'s `D_COMPLETED` break) |

### Design Decisions Documented

**Completion ordering — cleanup-first (diverges from callbag ecosystem):**
Research of callbag-subject, callbag-share, callbag-take, callbag-from-iter showed the ecosystem convention is notify-sinks-first-then-cleanup. Our library deliberately uses cleanup-first ordering for reentrancy safety: if a sink re-subscribes during END notification (resubscribable producers/operators), the producer must already be in a clean state. Tests codify this as the expected behavior.

**EffectImpl class removal:**
Confirmed zero `instanceof` usage in the library, no subclassing, class had only 1 own property and 1 prototype method. Pure closure eliminates class shell overhead and provides faster V8 variable access in hot paths.

### Tests Written

**Operator complete/error disconnects upstream (4 tests)** ✅
- complete() sends END to upstream deps
- error() sends END to upstream deps
- complete() disconnects multiple upstream deps
- Upstream events after complete() are ignored (handler is null)

**Snapshot-free completion reentrancy (3 tests)** ✅
- Producer: sink re-subscribes during END with resubscribable
- Producer: completed producer rejects new sinks (non-resubscribable)
- Operator: sink re-subscribes during END with resubscribable

**Producer completion ordering (2 tests)** ✅
- Cleanup runs before sinks receive END
- resetOnTeardown resets value before END notification

**Derived handles upstream END gracefully (1 test)** ✅
- Derived continues to return cached value after dep completes

**Effect dispose semantics (2 tests)** ✅
- Effect cleanup runs on dispose
- Effect ignores events after dispose

**Full upstream END handling + protocol ordering (14 tests, second pass)** ✅
- Derived: dep completion → sinks receive END; dep error → sinks receive END with error
- Derived: after dep END, get() recomputes from dep cache
- Derived: late subscriber after dep END gets immediate END
- Derived: dep END disconnects all upstream deps
- Derived: dep completes during initial connection → START then END order
- Effect: dep completion → cleanup runs; dep error → cleanup runs
- Effect: after dep END, further events from other deps ignored
- Effect: handles DATA without prior DIRTY (raw callbag sources)
- Operator: init-time complete() stops dep loop — no resource leak ← bug fixed
- Operator: resetOnTeardown resets value on complete()/error()
- Producer: snapshot-free resubscription reentrancy extended

**⚠️ Watch list — not yet a confirmed bug, keep an eye on:**
- `derived` and `effect` send `END` back to the dep that *just sent* them `END` (in the upstream-disconnect loop). For standard producers and derived nodes this is safe (their talkback checks `!this._sinks` → early return). However, a custom callbag source whose talkback does not guard against receiving END after completing could misbehave. Add a test if an issue is ever observed with custom sources.

**Actual: 28 tests, 2 bug fixes (operator upstream disconnect × 2)**

---

## Summary

| Batch | Focus | Tests | Fixes | Status |
|-------|-------|-------|-------|--------|
| 1 | Untested operators (first/last/find/elementAt/partition) | 42 | 3 | ✅ Done |
| 2 | Source factories + buffer error/completion | 31 | 3 | ✅ Done |
| 3 | Core primitives edge cases | 45 | 1 | ✅ Done |
| 4 | Reconnect/lifecycle across all operators | 26 | 0 | ✅ Done |
| 5 | Reentrancy, stress, complex chains | 29 | 1 | ✅ Done |
| 6 | Protocol, batch, interop | 27 | 0 | ✅ Done |
| 7 | Gap coverage (flat/switchMap/repeat/pipeRaw/Inspector) | 39 | 2 | ✅ Done |
| Post | Optimization pass & code review | 28 | 2 | ✅ Done |
| **Total** | | **267** | **12** | **All done** |

## Test File Strategy

- **Batch 1** → `src/__tests__/extras/selection-operators.test.ts` (first/last/find/elementAt/partition)
- **Batch 2** → `src/__tests__/extras/sources.test.ts` (fromIter/fromPromise/fromObs/fromEvent/interval/of/empty/throwError/never/buffer)
- **Batch 3** → `src/__tests__/core/primitives-edge-cases.test.ts`
- **Batch 4** → `src/__tests__/extras/reconnect.test.ts`
- **Batch 5** → `src/__tests__/extras/stress.test.ts`
- **Batch 6** → `src/__tests__/core/protocol-edge-cases.test.ts`
- **Batch 7** → `src/__tests__/extras/batch7-gaps.test.ts` (flat/switchMap/repeat/pipeRaw/SKIP/Inspector)
- **Post-batch** → `src/__tests__/core/completion-ordering.test.ts` (operator upstream disconnect, snapshot-free reentrancy, completion ordering, derived END, effect dispose)
