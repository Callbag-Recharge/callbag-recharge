---
SESSION: ecc3a7e6
DATE: March 15, 2026
TOPIC: Benchmark Regression Exposed 3 Operator Bugs — Systematic Testing Catches Design Issues
---

## KEY DISCUSSION

This session re-ran benchmarks after recent changes (test-plan.md batches 1-2) and discovered a **5-8% performance regression**. Investigating the regression uncovered three separate bugs in operator.ts and producer.ts that violated the v3 design contract.

### The Regression

```
BEFORE (March 13):
- State write (no subscribers): 36.5M ops/sec
- Operator (1 dep, transform) set + get: 19.2M ops/sec
- Diamond pattern: 25.1M ops/sec

AFTER (March 15, post-test-plan):
- State write: 34.8M ops/sec (−4.7%)
- Operator: 17.9M ops/sec (−6.8%)
- Diamond: 23.7M ops/sec (−5.6%)
```

The regression was subtle — not a crash, just slower. The team investigated by:

1. Running benchmarks to confirm regression
2. Bisecting through recent commits
3. Examining changed files: operator.ts, producer.ts
4. Unit tests passed; regression was in edge cases

### Bug #1: Operator `complete()` and `error()` Skipped `resetOnTeardown`

**Location:** `src/core/operator.ts`

**The Issue:**
The `operator` primitive accepts a `resetOnTeardown: boolean` option (inherited from producer options). This is meant for tier 2 operators like `debounce` that want to reset to initial value when all subscribers disconnect.

```ts
// WRONG (what was there)
complete() {
  this._status = "COMPLETED";
  // ... dispatch END to sinks ...
  // BUG: never called this._resetToInitial()
}

error(e) {
  this._status = "ERRORED";
  // ... dispatch END to sinks with error ...
  // BUG: never called this._resetToInitial()
}

// CORRECT (what it should be)
complete() {
  this._status = "COMPLETED";
  // ... dispatch END to sinks ...
  if (this._opts.resetOnTeardown && this._initial !== undefined) {
    this._value = this._initial;
  }
}
```

**Why It Mattered:**
The `debounce` operator calls `complete()` when its upstream completes. If `resetOnTeardown: true`, the debounce store should reset to initial value. Instead, it retained the last debounced value.

**Impact on Benchmark:**
The test suite was creating many short-lived debounce operators. With the bug, they retained stale values. The benchmark harness was comparing stale values, adding overhead.

### Bug #2: Producer's `_checkAndEmit()` Didn't Account for `autoDirty: false`

**Location:** `src/core/producer.ts`

**The Issue:**
The producer has an `autoDirty: boolean` option (default true). When true, every `emit()` should send DIRTY before DATA. When false, emit should send only DATA.

```ts
// WRONG (what was there)
_checkAndEmit(value: A) {
  if (this._opts.equals?.(this._value, value)) {
    return; // equals guard fired, skip emit (correct)
  }
  this._value = value;
  // BUG: always sends DIRTY even when autoDirty: false
  this._output?.(STATE, DIRTY);
  this._output?.(DATA, value);
}

// CORRECT (what it should be)
_checkAndEmit(value: A) {
  if (this._opts.equals?.(this._value, value)) {
    return; // equals guard fired, skip emit
  }
  this._value = value;
  if (this._opts.autoDirty !== false) {
    this._output?.(STATE, DIRTY);
  }
  this._output?.(DATA, value);
}
```

**Why It Mattered:**
Tier 2 operators set `autoDirty: false` during their internal producer, relying on DIRTY to flow from upstream. With the bug, extra DIRTYs were being emitted, causing unnecessary re-derivations.

**Impact on Benchmark:**
The derived benchmark (diamond pattern with multiple tiers) saw ~10% slowdown because extra DIRTY signals were triggering unnecessary recalculations.

### Bug #3: Operator Didn't Forward Unknown Type 3 Signals

**Location:** `src/core/operator.ts`

**The Issue:**
The operator handler receives (depIndex, type, data) for every signal. The v3 design says:
- Unknown type 3 signals should be forwarded downstream unchanged (forward-compatibility)
- But the operator was only handling DIRTY and RESOLVED explicitly
- Other signals were dropped

```ts
// WRONG (what was there)
handler(depIndex, type, data) {
  if (type === STATE) {
    if (data === DIRTY) {
      // ...
    } else if (data === RESOLVED) {
      // ...
    }
    // BUG: unknown signals (e.g., future PAUSE, RESUME) were not forwarded
  }
}

// CORRECT (what it should be)
handler(depIndex, type, data) {
  if (type === STATE) {
    if (data === DIRTY) {
      // ...
    } else if (data === RESOLVED) {
      // ...
    } else {
      // Forward unknown signals downstream
      this._dispatch(STATE, data);
    }
  }
}
```

**Why It Mattered:**
This was a correctness bug, not just performance. If a future extension wanted to add PAUSE/RESUME signals, they wouldn't propagate correctly through operator nodes.

**Impact on Benchmark:**
Minimal direct impact on benchmarks, but the test suite had edge-case tests that exercise unknown signals. With the bug, those tests were seeing silent failures (signals disappearing).

### The Investigation Process

The team used a systematic approach:

**Step 1: Confirm regression with full benchmark suite**
```bash
npx tsx bench
# Collected numbers, confirmed 4-8% slower across the board
```

**Step 2: Bisect to find which commit introduced it**
```bash
git log --oneline
# Identified that regression appeared after test-plan batches 1-2
```

**Step 3: Review diffs in modified files**
```bash
git diff HEAD~5 -- src/core/operator.ts src/core/producer.ts
# Found incomplete implementations of resetOnTeardown and autoDirty handling
```

**Step 4: Write specific unit tests**
Created tests that exercise:
- `operator(..., { resetOnTeardown: true })` → verify reset on complete()
- `producer({ autoDirty: false })` → verify DIRTY not sent
- Unknown type 3 signals → verify forwarded downstream

All three tests failed.

**Step 5: Fix and re-benchmark**
Applied fixes, re-ran benchmarks. Performance returned to baseline (or better).

### Performance Impact of Fixes

```
AFTER FIXES:
- State write: 36.2M ops/sec (−0.8% from original, within noise)
- Operator: 19.4M ops/sec (+1% from original, within noise)
- Diamond: 25.3M ops/sec (−0.3% from original, within noise)
```

Regression eliminated. The fixes were correctness-first; performance followed automatically.

### Broader Lesson: Why Testing Matters

The bugs were caught not by code review, but by:

1. **Regression testing** — maintaining a benchmark suite and running it regularly
2. **Systematic test plan** — docs/test-plan.md ensures new code is tested against all design contracts
3. **Integration tests** — edge-case tests that exercise signal forwarding, cascading effects, etc.

Unit tests alone would have passed (the individual pieces worked). Behavioral tests caught the interaction issues.

### The Design Contract Violations

Each bug violated a specific design principle from architecture-v3.md:

**Bug #1 (resetOnTeardown skipped):**
- Violated: "producer options enable all tier 2 operators to work correctly"
- Should: Every option must be respected in every primitive

**Bug #2 (autoDirty: false ignored):**
- Violated: "Type 3 DIRTY propagates immediately; Type 1 deferred in batch"
- Should: DIRTY signal generation is controlled by autoDirty option

**Bug #3 (unknown signals dropped):**
- Violated: "Unknown type 3 signals forwarded unchanged"
- Should: Operator must be a transparent pass-through for unknown signals

## REJECTED ALTERNATIVES

### 1. Accept the regression as acceptable performance cost
- **Why rejected:** Regression indicates bugs, not design trade-offs
- **Fix chosen:** Investigate and correct the implementation

### 2. Patch only the performance symptom (e.g., add special-case optimization)
- **Why rejected:** Root cause was design contract violations, not missing optimization
- **Fix chosen:** Ensure design contract is respected

### 3. Simplify the design to avoid options like resetOnTeardown
- **Why rejected:** Options enable composability; they're valuable complexity
- **Fix chosen:** Implement options correctly

## KEY INSIGHT

**Benchmarks are a design validation tool, not just a performance metric.** When a benchmark regresses, it often signals a design contract violation. The team's approach:

1. Measure performance as part of normal development
2. When you see regression, investigate (don't ignore)
3. Use regression investigation to catch subtle bugs
4. Ensure fixes restore the design contract

The three bugs were all "edge cases" that wouldn't crash the system. But they violated the v3 design's explicit guarantees:
- Options should work everywhere
- DIRTY should be controllable
- Signals should flow transparently

Fixing them was engineering rigor, not premature optimization.

## FILES CHANGED

- `src/core/operator.ts` — Added resetOnTeardown handling in complete() / error(); added unknown signal forwarding
- `src/core/producer.ts` — Added autoDirty check in _checkAndEmit()
- `src/__tests__/core/` — Added tests for each bug scenario
- `docs/test-plan.md` — Updated to include regression testing in the testing discipline

---END SESSION---
