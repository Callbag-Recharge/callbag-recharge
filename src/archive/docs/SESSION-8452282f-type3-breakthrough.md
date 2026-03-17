---
SESSION: 8452282f
DATE: March 14, 2026
TOPIC: Type 3 Control Channel Breakthrough — Separating State Signals from Data
---

## KEY DISCUSSION

This session was a pivotal brainstorm that evolved the architecture from v2 (dual-channel with DIRTY push and value pull via get()) to v3 (two-phase push on a single callbag with type 3 control channel).

### The Core Problem (v2 Limitations)

The v2 design had inelegant separation of concerns:
- DIRTY signals flowed through callbag (type 1 DATA channel) as sentinels
- Actual values were pulled via direct `.get()` calls
- This violated the callbag principle: **callbag is already used for wiring, why make data bypass it?**

The team recognized that callbag protocol supports 4 types:
- Type 0: START handshake
- Type 1: DATA (payload)
- Type 2: END (completion)
- **Type 3: Available but unused** — reserved for custom signals

### The Breakthrough Insight

Why not use type 3 as a **dedicated control channel** for state management signals (DIRTY, RESOLVED) while type 1 carries only real values?

This solves three problems at once:
1. **Pure values on DATA** — type 1 never carries sentinels, only real user values
2. **Unified transport** — both signals and values flow through callbag, not partially outside it
3. **Forward compatibility** — type 3 becomes extensible (PAUSE, RESUME, etc.) without breaking type 1

### The Two-Phase Push Model

Separating signals from data naturally leads to **two-phase push**:

```
Phase 1: STATE signals (DIRTY propagates downstream)
sink(STATE, DIRTY)    // "prepare"

Phase 2: DATA values (after computation/caching)
sink(DATA, value)     // "new value"
OR
sink(STATE, RESOLVED) // "value didn't change"
```

Key behaviors:
- **DIRTY always comes first** — downstream nodes know to wait for DATA
- **RESOLVED as alternative phase 2** — when `equals` guard fires, emit RESOLVED instead of DATA
- **Diamond resolution via bitmask** — nodes with multiple deps count dirty bits, wait for all to resolve
- **Derived caches values** — no more re-compute on every access, `.get()` returns cache

### Why This is Better Than Pull-Phase Memoization

The v2 approach (pull values via `.get()`, use `equals` to decide whether to propagate downstream) had two issues:

1. **Downstream doesn't know when a dep is stale** — pulled `.get()` looks current but may be mid-computation
2. **Expensive re-computation** — always runs the function, then compares; no way to avoid the compute itself

The v3 type 3 approach:
- Downstream knows the exact state via STATE signals
- `equals` on derived sends RESOLVED immediately after computing — **no need to recompute downstream if it hasn't changed**
- Entire subtrees can be skipped via RESOLVED propagation (true push-phase memoization)

### Implementation Insight: Why Derived Eagerly Connects

The team decided **derived nodes auto-connect to deps at construction** (STANDALONE mode). Why?

- User expectation: `const s = derived([a], fn); s.get()` should return the current value immediately
- Without eager connection, `.get()` would either:
  - Return stale value (wrong)
  - Trigger pull-phase recompute (expensive, violates "push-first" design)
- With eager connection via closures, `s._cachedValue` is always current
- Even without external subscribers, `get()` is honest and instant

Trade-off: adds memory cost (talkbacks stay alive) but fixes the mental model.

### Producer as Universal Base

All sources (state, producer, events) use a unified **producer() primitive** that:
- Has `emit()` (push value + DIRTY signal)
- Has `signal()` (send custom STATE signal)
- Has `complete()` / `error()` (send END)
- Supports `initial` value (baseline before start)
- Supports `equals` guard (skip emit if value unchanged)
- Supports `resetOnTeardown` (reset to initial when all subscribers leave)
- Supports `autoDirty: true` (emit DIRTY before each DATA)

This unifies all tier 1 and tier 2 sources without needing separate Stream/StreamProducer implementations.

## REJECTED ALTERNATIVES

### 1. Keep v2 Dual-Channel (DIRTY push + value pull)
- **Why rejected:** Violates callbag principle, makes debugging harder (data split across channels), awkward for tier 2 operators

### 2. Use Type 1 DATA for Both Signals and Values
- **Why rejected:** Sentinels (DIRTY) mixed with real values make receivers confused ("is this data or a signal?")
- **Type 3 solves this cleanly:** unknown type 3 signals forward unchanged (extensible), type 1 is always trustworthy data

### 3. Pull-Phase Memoization (v2 approach: compute, then compare)
- **Why rejected:** Still requires recompute even when value is unchanged; doesn't inform downstream until after the fact
- **Type 3 + RESOLVED:** Emit decision is made *during* compute, RESOLVED suppresses downstream recompute entirely

### 4. Lazy Derived Connection (only connect on first subscriber)
- **Why rejected:** `.get()` would be stale or trigger expensive recompute
- **STANDALONE mode chosen:** eager connection, cached value always fresh, mental model is honest

### 5. Separate Stream/StreamProducer Classes
- **Why rejected:** Producer options (initial, equals, error) can be applied to all sources
- **Single producer() primitive:** flexible, less code duplication

### 6. SKIP as a Type 3 Control Signal
- **Why rejected:** SKIP and DIRTY/RESOLVED solve different problems at different layers
  - DIRTY/RESOLVED are state coordination (diamond resolution, memoization)
  - SKIP is a filter decision (operator semantics, at transform time)
  - Mixing them blurs concerns

## KEY INSIGHT

**Type 3 unifies state management under callbag protocol without compromising data integrity.** The insight was recognizing that callbag's 4-type system was designed for exactly this use case — signals can have their own channel. This led to the two-phase push model where:
- Phase 1 (DIRTY) establishes the dirty state graph
- Phase 2 (DATA or RESOLVED) flows values or memoization decisions
- Diamond resolution works via bitmask at convergence points
- Entire subtrees can be skipped via RESOLVED propagation

The decision to use the standard callbag protocol cleanly, rather than trying to squeeze everything onto type 1, became the foundation for v4.

## FILES CHANGED

- `docs/architecture-v3.md` — Full specification of v3 design (type 3 control channel, producer options, batches 1-4)
- `src/core/protocol.ts` — Added STATE=3, DIRTY/RESOLVED symbols
- `src/core/types.ts` — Actions<T> interface, ProducerStore<T> type
- `src/core/producer.ts` — Rewritten as universal base with options
- `src/core/state.ts` — Thin wrapper (set=emit, update sugar, equals defaults to Object.is)
- `src/core/derived.ts` — STANDALONE mode, type 3 dirty tracking, RESOLVED memoization
- `src/core/operator.ts` — General-purpose transform with (depIndex, type, data) handler
- `src/core/effect.ts` — Inline execution, RESOLVED skip
- `src/core/subscribe.ts` — Pure callbag sink

---END SESSION---
