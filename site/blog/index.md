---
outline: deep
---

# Engineering Blog

Behind-the-scenes stories from building callbag-recharge — the architecture decisions, the bugs that taught us something, and the ideas that didn't survive contact with reality.

## The callbag-recharge Chronicle

### Arc 1: Origins — Why Revive Callbag?

| # | Post | Read time |
|---|------|-----------|
| 1 | [Callbag Is Dead. Long Live Callbag.](./01-callbag-is-dead-long-live-callbag) | 8 min |
| 2 | [The Protocol That Already Solved Your Problem](./02-the-protocol-that-already-solved-your-problem) | 10 min |
| 3 | [Signals Are Not Enough](./03-signals-are-not-enough) | 10 min |

### Arc 2: Architecture v1 — The Naive First Attempt

| # | Post | Read time |
|---|------|-----------|
| 4 | [Push Dirty, Pull Values: Our First Diamond Solution](./04-push-dirty-pull-values-our-first-diamond-solution) | 8 min |
| 5 | [Why Explicit Dependencies Beat Magic Tracking](./05-why-explicit-dependencies-beat-magic-tracking) | 8 min |
| 6 | [The Inspector Pattern: Observability as a First-Class Citizen](./06-the-inspector-pattern-observability-as-first-class-citizen) | 8 min |

### Arc 3: Architecture v2 — The Great Unification

| # | Post | Read time |
|---|------|-----------|
| 7 | [Data Should Flow Through the Graph, Not Around It](./07-data-should-flow-through-the-graph-not-around-it) | 9 min |
| 8 | [Two-Phase Push: DIRTY First, Values Second](./08-two-phase-push-dirty-first-values-second) | 9 min |
| 9 | [From Pull-Phase to Push-Phase Memoization](./09-from-pull-phase-to-push-phase-memoization) | 8 min |

### Arc 4: Architecture v3 — The Type 3 Breakthrough

| # | Post | Read time |
|---|------|-----------|
| 10 | [The Day We Read the Callbag Spec (Again)](./10-the-day-we-read-the-callbag-spec-again) | 7 min |
| 11 | [Why Control Signals Don't Belong in the Data Stream](./11-why-control-signals-dont-belong-in-the-data-stream) | 7 min |
| 12 | [RESOLVED: The Signal That Skips Entire Subtrees](./12-resolved-the-signal-that-skips-entire-subtrees) | 7 min |
| 13 | [Five Primitives, Two Tiers, Zero Schedulers](./13-five-primitives-two-tiers-zero-schedulers) | 8 min |

### Arc 5: Architecture v4 — Performance Without Compromise

| # | Post | Read time |
|---|------|-----------|
| 14 | [Output Slot: How null->fn->Set Saves 90% Memory](./14-output-slot-how-null-to-fn-to-set-saves-90-percent-memory) | 7 min |
| 15 | [When We Removed the ADOPT Protocol](./15-when-we-removed-the-adopt-protocol) | 6 min |
| 16 | [Lazy Tier 2: The switchMap Footgun We Had to Kill](./16-lazy-tier-2-the-switchmap-footgun-we-had-to-kill) | 6 min |
| 17 | [Bitmask Flag Packing in TypeScript](./17-bitmask-flag-packing-in-typescript) | 6 min |

### Arc 6: Correctness Stories

| # | Post | Read time |
|---|------|-----------|
| 18 | [Diamond Resolution Without Pull-Phase Computation](./18-diamond-resolution-without-pull-phase-computation) | 6 min |
| 19 | [When Not to Dedup: Understanding Callbag Operator Semantics](./19-when-not-to-dedup-understanding-callbag-operator-semantics) | 5 min |
| 20 | [Benchmark Regression Exposed 3 Operator Bugs](./20-benchmark-regression-exposed-3-operator-bugs) | 5 min |
| 21 | [The Cost of Correctness: 9.8M ops/sec vs Preact's 34M](./21-the-cost-of-correctness-9-8m-ops-vs-preacts-34m) | 6 min |

### Arc 7: From Library to Platform

| # | Post | Read time |
|---|------|-----------|
| 23 | [Stores All the Way Down: Adding State to Reactive Programming](./23-stores-all-the-way-down-adding-state-to-reactive-programming) | 6 min |
| 24 | [Why Our Computed States Are Eagerly Reactive](./24-why-our-computed-states-are-eagerly-reactive) | 6 min |
| 25 | [From Zustand to Reactive Orchestration](./25-from-zustand-to-reactive-orchestration) | 6 min |
| 26 | [The Missing Middle: Why Signals Aren't Enough for AI Streaming](./26-the-missing-middle-why-signals-arent-enough-for-ai-streaming) | 6 min |

### Arc 8: Engineering Deep Cuts

| # | Post | Read time |
|---|------|-----------|
| 22 | [Promises Are the New Callback Hell](./22-promises-are-the-new-callback-hell) | 6 min |
| 27 | [switchMap Error Handling: The Bug That Tests Didn't Catch](./27-switchmap-error-handling-the-bug-that-tests-didnt-catch) | 5 min |
| 28 | [Skip DIRTY: How We Halved Dispatch for Single-Dep Paths](./28-skip-dirty-how-we-halved-dispatch-for-single-dep-paths) | 5 min |
| 29 | [Bitmask Overflow at >32 Dependencies](./29-bitmask-overflow-at-more-than-32-dependencies) | 5 min |
| 30 | [Why We Don't Use queueMicrotask (And Neither Should You)](./30-why-we-dont-use-queuemicrotask-and-neither-should-you) | 5 min |
