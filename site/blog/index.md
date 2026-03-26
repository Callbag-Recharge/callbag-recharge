---
outline: deep
---

# Engineering Blog

Behind-the-scenes stories from building callbag-recharge — the architecture decisions, the bugs that taught us something, and the ideas that didn't survive contact with reality.

## The callbag-recharge Chronicle

### Arc 1: Origins — Why Revive Callbag?

| # | Post | Date | Read time |
|---|------|------|-----------|
| 1 | [Callbag Is Dead. Long Live Callbag.](./01-callbag-is-dead-long-live-callbag) | March 21, 2026 | 8 min |
| 2 | [The Protocol That Already Solved Your Problem](./02-the-protocol-that-already-solved-your-problem) | March 21, 2026 | 10 min |
| 3 | [Signals Are Not Enough](./03-signals-are-not-enough) | March 21, 2026 | 10 min |

### Arc 2: Architecture v1 — The Naive First Attempt

| # | Post | Date | Read time |
|---|------|------|-----------|
| 4 | [Push Dirty, Pull Values: Our First Diamond Solution](./04-push-dirty-pull-values-our-first-diamond-solution) | March 22, 2026 | 8 min |
| 5 | [Why Explicit Dependencies Beat Magic Tracking](./05-why-explicit-dependencies-beat-magic-tracking) | March 22, 2026 | 8 min |
| 6 | [The Inspector Pattern: Observability as a First-Class Citizen](./06-the-inspector-pattern-observability-as-first-class-citizen) | March 22, 2026 | 8 min |

### Arc 3: Architecture v2 — The Great Unification

| # | Post | Date | Read time |
|---|------|------|-----------|
| 7 | [Data Should Flow Through the Graph, Not Around It](./07-data-should-flow-through-the-graph-not-around-it) | March 23, 2026 | 9 min |
| 8 | [Two-Phase Push: DIRTY First, Values Second](./08-two-phase-push-dirty-first-values-second) | March 23, 2026 | 9 min |
| 9 | [From Pull-Phase to Push-Phase Memoization](./09-from-pull-phase-to-push-phase-memoization) | March 23, 2026 | 8 min |

### Arc 4: Architecture v3 — The Type 3 Breakthrough

| # | Post | Date | Read time |
|---|------|------|-----------|
| 10 | [The Day We Read the Callbag Spec (Again)](./10-the-day-we-read-the-callbag-spec-again) | March 24, 2026 | 7 min |
| 11 | [Why Control Signals Don't Belong in the Data Stream](./11-why-control-signals-dont-belong-in-the-data-stream) | March 24, 2026 | 7 min |
| 12 | [RESOLVED: The Signal That Skips Entire Subtrees](./12-resolved-the-signal-that-skips-entire-subtrees) | March 24, 2026 | 7 min |
| 13 | [Five Primitives, Two Tiers, Zero Schedulers](./13-five-primitives-two-tiers-zero-schedulers) | March 24, 2026 | 8 min |

### Arc 5: Architecture v4 — Performance Without Compromise

| # | Post | Date | Read time |
|---|------|------|-----------|
| 14 | [Output Slot: How null->fn->Set Saves 90% Memory](./14-output-slot-how-null-to-fn-to-set-saves-90-percent-memory) | March 25, 2026 | 7 min |
| 15 | [When We Removed the ADOPT Protocol](./15-when-we-removed-the-adopt-protocol) | March 25, 2026 | 6 min |
| 16 | [Lazy Tier 2: The switchMap Footgun We Had to Kill](./16-lazy-tier-2-the-switchmap-footgun-we-had-to-kill) | March 25, 2026 | 6 min |
| 17 | [Bitmask Flag Packing in TypeScript](./17-bitmask-flag-packing-in-typescript) | March 25, 2026 | 6 min |

### Arc 6: Correctness Stories

| # | Post | Date | Read time |
|---|------|------|-----------|
| 18 | [Diamond Resolution Without Pull-Phase Computation](./18-diamond-resolution-without-pull-phase-computation) | March 25, 2026 | 6 min |
| 19 | [When Not to Dedup: Understanding Callbag Operator Semantics](./19-when-not-to-dedup-understanding-callbag-operator-semantics) | March 25, 2026 | 5 min |
| 20 | [Benchmark Regression Exposed 3 Operator Bugs](./20-benchmark-regression-exposed-3-operator-bugs) | March 25, 2026 | 5 min |
| 21 | [The Cost of Correctness: 9.8M ops/sec vs Preact's 34M](./21-the-cost-of-correctness-9-8m-ops-vs-preacts-34m) | March 25, 2026 | 6 min |

### Arc 7: From Library to Platform

| # | Post | Date | Read time |
|---|------|------|-----------|
| 23 | [Stores All the Way Down: Adding State to Reactive Programming](./23-stores-all-the-way-down-adding-state-to-reactive-programming) | March 25, 2026 | 6 min |
| 24 | [Why Our Computed States Are Eagerly Reactive](./24-why-our-computed-states-are-eagerly-reactive) | March 25, 2026 | 6 min |
| 25 | [From Zustand to Reactive Orchestration](./25-from-zustand-to-reactive-orchestration) | March 25, 2026 | 6 min |
| 26 | [The Missing Middle: Why Signals Aren't Enough for AI Streaming](./26-the-missing-middle-why-signals-arent-enough-for-ai-streaming) | March 25, 2026 | 6 min |

### Arc 8: Engineering Deep Cuts

| # | Post | Date | Read time |
|---|------|------|-----------|
| 22 | [Promises Are the New Callback Hell](./22-promises-are-the-new-callback-hell) | March 25, 2026 | 6 min |
| 27 | [switchMap Error Handling: The Bug That Tests Didn't Catch](./27-switchmap-error-handling-the-bug-that-tests-didnt-catch) | March 25, 2026 | 5 min |
| 28 | [Skip DIRTY: How We Halved Dispatch for Single-Dep Paths](./28-skip-dirty-how-we-halved-dispatch-for-single-dep-paths) | March 25, 2026 | 5 min |
| 29 | [Bitmask Overflow at >32 Dependencies](./29-bitmask-overflow-at-more-than-32-dependencies) | March 25, 2026 | 5 min |
| 30 | [Why We Don't Use queueMicrotask (And Neither Should You)](./30-why-we-dont-use-queuemicrotask-and-neither-should-you) | March 25, 2026 | 5 min |
