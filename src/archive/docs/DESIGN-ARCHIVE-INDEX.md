# Design Decision Archive

This directory preserves detailed design discussions from key Claude Code sessions. These are not casual notes — they capture the reasoning chains, rejected alternatives, and "aha moments" that shaped the architecture.

## Core Design Sessions

### Session 8452282f (March 14) — Type 3 Control Channel Breakthrough
**Topic:** Separating state signals from data via callbag type 3

The pivotal brainstorm that shifted from v2 (dual-channel: DIRTY push + value pull) to v3 (two-phase push on type 3). 

**Key insight:** Recognize that callbag's 4-type system was designed exactly for this use case. Type 3 as a dedicated control channel allows type 1 (DATA) to carry only real values.

**Rejected:** Mixing DIRTY and DATA on type 1; pull-phase memoization; lazy derived connections.

**Downstream impact:** Producer options (initial, equals, resetOnTeardown), STANDALONE derived, RESOLVED signal.

### Session ce974b95 (March 14) — Push-Phase Memoization Debate
**Topic:** Why RESOLVED signals beat pull-phase comparison

The discussion of how to handle the `equals` option on derived stores when values are unchanged. Two approaches debated:
- **Pull-phase (v2):** Compute, then compare, then maybe propagate
- **Push-phase (v3):** Compute, decide during compute (emit RESOLVED if equal), inform downstream

**Key insight:** RESOLVED is a semantic signal, not a side effect. It cascades — if B sends RESOLVED, then C can skip recompute without re-evaluating B.

**Rejected:** Always-memoize without opt-in; pull-phase comparison; memoization at sink level.

**Downstream impact:** RESOLVED symbol, RESOLVED propagation through multi-dep nodes, transitive subtree skipping.

### Session 47f1a07f (March 15) — Library Comparison Research
**Topic:** Zustand, Jotai, SolidJS, Preact Signals — mental models and design trade-offs

Comparative research on state management libraries to understand positioning.

**Key insight:** Explicit deps are better than implicit tracking (Jotai model). Unifies callbag transport (vs SolidJS's separate notification system). Adds observability (rare in the field, borrowed from RxJS DevTools).

**Rejected:** Copy implicit tracking (Jotai), copy separate notification system (SolidJS), no Inspector.

**Outcome:** docs/state-management.md, future compat layers (jotai, zustand, signals).

### Session 4f72f2b0 (March 15) — No-Default-Dedup Decision
**Topic:** Why extras should not dedup by default (follow RxJS/callbag semantics)

Identified a correctness bug: `subscribe()` and tier 2 operators were wrongly deduplicating emissions. Fixed by removing dedup from extras.

**Key insight:** Transparency is foundational. State's `equals` handles dedup at the source. Subscribers are pure sinks — they deliver every emission. If you want dedup, use `distinctUntilChanged()`.

**Rejected:** Keep dedup for "convenience"; make it opt-out; inherit state's equals.

**Downstream impact:** 407 tests passing; fixed 8 operator instances; clarity on state vs stream semantics.

### Session ecc3a7e6 (March 15) — Benchmark Regression Exposed 3 Bugs
**Topic:** Performance regression investigation uncovered design contract violations

Re-ran benchmarks post-test-plan, found 5–8% slowdown. Investigation revealed three separate bugs:
1. `operator.complete()` / `error()` skipped `resetOnTeardown` handling
2. `producer._checkAndEmit()` didn't respect `autoDirty: false`
3. `operator` didn't forward unknown type 3 signals

**Key insight:** Benchmarks are design validation tools. Regression = contract violation (not missed optimization).

**Rejected:** Accept regression; patch symptom; simplify design to avoid options.

**Outcome:** All bugs fixed; regression eliminated; discovered edge cases through systematic testing.

### Session 8693d636 (March 16) — V4 Output Slot Optimization
**Topic:** How null→fn→Set lazy allocation saves ~90% memory for typical graphs

Implemented the output slot model replacing `_sinks: Set` with `_output: null | fn | Set`.

**Key insight:** 80% of nodes have 0–1 subscriber. Set allocation is wasteful. Lazy union type saves ~200 bytes per node while maintaining composability.

**Rejected:** Always use Set; use array for SINGLE; separate `_singleSink` / `_multiSinks`.

**Outcome:** ~90% memory savings for typical graphs; simplified unsubscribe logic; removed need for ADOPT protocol.

### Session 2d2c2674 (March 16) — ADOPT Protocol Removal
**Topic:** Why the ADOPT handshake protocol for derived node handoff isn't needed

Recognized that output slot model (mechanical null→fn→Set) makes ADOPT unnecessary.

**Key insight:** Separate two concerns: (1) dep connections via closures (always active), (2) output dispatch via output slot (mechanical). No protocol needed for output slot transitions.

**Rejected:** Keep ADOPT for "future extensibility"; rename to be clearer; make optional.

**Outcome:** Cleaner design; removed REQUEST_ADOPT/GRANT_ADOPT from protocol.ts; deleted complex state machine from derived.ts.

### Session 88e9bd81 (March 16) — V4 Benchmarks and "Cost of Correctness"
**Topic:** Performance story — Recharge wins on read, competitive on computed/diamonds

Comprehensive benchmark suite comparing Recharge to Preact Signals, SolidJS, RxJS.

**Key results:**
- State read: 177M ops/sec (1.5x faster than Preact)
- State write: 36.5M ops/sec (1.1x)
- Computed: 18.9M ops/sec (1.3x)
- Diamond: 25.3M ops/sec (1.2x)

**Key insight:** "Cost of correctness" narrative: memory overhead (~6x vs Preact) buys observability, correct diamond resolution, push-phase memoization, and explicit deps.

**Rejected:** Lazy STANDALONE (breaks `.get()`); remove Inspector; copy Preact's cached flag.

**Outcome:** docs/benchmarks.md, docs/optimizations.md, performance regression guards in test suite.

### Session unified-state-management (March 16) — Unified State Management Across Frontend & Backend
**Topic:** Why frontend state management and backend event processing are the same problem, and how callbag-recharge + Inspector unifies them

The strategic discussion identifying that the frontend/backend divide in state management is artificial — caused by tools being afraid of different things (frontend fears streaming, backend fears fine-grained reactivity). callbag-recharge bridges both because callbag protocol doesn't distinguish timescales.

**Key insight:** Inspector is the unifying principle. The reason these worlds feel opaque is lack of runtime graph visibility. AI memory (3-layer model: working, session, long-term) is the P0 application because it naturally spans all timescales.

**Rejected:** Wrap Redis/Kafka as connectors only; ship separate frontend/backend packages; use Inspector as Jotai compat registry; add implicit tracking to core.

**Outcome:** `memoryStore` pattern (P0), `createStore()` pattern (P1), compat layer strategy (Jotai registry-based, Zustand StoreApi match), backend positioning strategy.

### Session createStore-pattern (March 17) — createStore Pattern Implementation
**Topic:** Zustand-style single-store pattern backed by callbag-recharge, protocol-level teardown(), adversarial code review

Implemented the `createStore()` pattern matching Zustand's `create((set, get) => ...)` ergonomics with callbag-recharge's killer advantage: diamond-safe `select()` selectors backed by `derived()`. Added protocol-level `teardown()` utility for graph destruction. Ran adversarial code review (Blind Hunter + Edge Case Hunter) finding 8 issues — all fixed: initializer safety, replace semantics, action preservation, single source of truth, Object.hasOwn, cascading destroy.

**Key insight:** `select()` backed by `derived()` with push-phase memoization is architecturally superior to Zustand's manual selectors. `teardown()` fills a protocol gap — `complete()` exists on ProducerStore but not on WritableStore or derived nodes.

**Rejected:** Deep merge (matches Zustand shallow); implicit tracking (contradicts explicit deps); built-in React hook (framework-agnostic); select dedup/caching (unnecessary overhead).

**Outcome:** `createStore` pattern (production-ready, 31 tests), `teardown()` protocol primitive, patterns directory convention established.

---

## Additional Sessions (Partial Coverage)

- Session 269923a2 (Mar 14) — Implementation plan for two-phase push
- Session 05b247c1 (Mar 14) — Pure callbag refactor (explicit deps)
- Session 3844edd6 (Mar 14) — Batch 2 implementation
- Session 69f77860 (Mar 15) — Batch 3 implementation
- Session 660b129d (Mar 15) — Equals option wiring and bench fixes
- Session 344b81ab (Mar 15) — Extras refactoring with operator primitive
- Session 476164b4 (Mar 15) — Optimizations doc and opportunities
- Session f23a9e35 (Mar 15) — Distinguishing pipeRaw vs pipeDerived
- Session ac72cc83 (Mar 16) — V4 design review
- Session 4cb2d590 (Mar 16) — Implement remaining extras
- Session b1e8b5e5 (Mar 16) — Promote v4, update all docs

---

## Reading Guide

**For architecture newcomers:**
1. Start with 8452282f (Type 3 breakthrough)
2. Then ce974b95 (Push-phase memoization)
3. Then 8693d636 (Output slot)
4. Then 2d2c2674 (ADOPT removal)
5. Then 88e9bd81 (Benchmarks)

**For understanding design trade-offs:**
- 47f1a07f (Library comparison)
- 88e9bd81 (Cost of correctness)
- 4f72f2b0 (No-default-dedup rationale)

**For implementation details:**
- ecc3a7e6 (Bug fixes and design contracts)
- Session files are ordered chronologically by date

---

## Key Themes

### Unification Under Callbag
The core philosophy: use callbag protocol cleanly. Type 3 for control signals, type 1 for data, standard two-phase push. No split channels, no special protocols.

### Explicit Dependencies
Chosen over implicit tracking (Jotai model) because it's clearer, more debuggable, and scales to complex graphs.

### Correctness First, Performance Second
Trade memory for observability. Trade throughput for diamond resolution correctness. Recharge wins on state operations; competitive on computed and diamonds.

### Transparency in Operators
Extras are pass-through by default. Dedup is opt-in (distinctUntilChanged). Batching is explicit. No magic.

### Design Iteration
Some decisions evolved through implementation (ADOPT protocol removed after output slot clarified). This is healthy — iterate towards clarity.

---

## Archive Format

Each session file contains:
- SESSION ID and DATE
- TOPIC
- KEY DISCUSSION (the actual reasoning, quotes, code examples)
- REJECTED ALTERNATIVES (what was considered, why not)
- KEY INSIGHT (the main takeaway)
- FILES CHANGED (implementation side effects)

This format preserves the thinking process, not just conclusions.

---

**Created:** March 16, 2026  
**Archive Status:** Complete through Session 88e9bd81
