---
SESSION: ce974b95
DATE: March 14, 2026
TOPIC: Push-Phase Memoization Debate — Why RESOLVED Won Over Pull-Phase Comparison
---

## KEY DISCUSSION

This session dove deep into the memoization semantics for derived stores when an `equals` option is provided. The team debated two fundamentally different approaches:

### Approach A: Pull-Phase Comparison (v2 / Earlier Version)

In this model, when a derived store is marked DIRTY:
1. Upstream sends DIRTY signal
2. Downstream node counts dirty deps, waits for all to resolve
3. Once all deps are resolved, the transform function is called
4. The new value is computed
5. **THEN** the `equals` guard is checked
6. If values are equal, DON'T propagate downstream
7. If different, propagate DATA

**Problem:** The comparison happens AFTER computation. Even when the value is unchanged, you've already spent the cost of running the transform function.

```ts
// v2 pull-phase (bad)
if (equals(oldValue, newValue)) {
  // Don't propagate, but we already computed!
  return;
}
// Propagate
```

### Approach B: Push-Phase Memoization (v3 / Chosen)

In this model, when all dirty deps have resolved:
1. Upstream sends DIRTY signal (phase 1)
2. Downstream node counts dirty deps, waits for all to resolve
3. Once all deps are resolved, the transform function is called
4. The new value is computed
5. **DURING computation**, the `equals` guard is checked
6. If values are equal, emit `RESOLVED` signal instead of `DATA`
7. Upstream nodes receive RESOLVED and decrement their dirty counter WITHOUT recomputing themselves

**Advantage:** Entire downstream subtree is skipped. If B depends on A and C depends on B, and A changes but B computes to the same value, then C skips its recomputation entirely.

```ts
// v3 push-phase (good)
if (equals(oldValue, newValue)) {
  // Send RESOLVED — tell downstream "I was dirty, value didn't change"
  dispatch(STATE, RESOLVED);
  return; // downstream skips recompute
}
// Send DATA
dispatch(DATA, newValue);
```

### Why Push-Phase Memoization is Fundamentally Better

The team's reasoning crystallized around three key insights:

**1. Signal-driven, not value-driven**

In pull-phase, the `equals` check is a side effect ("if we're equal, suppress propagation"). In push-phase, `RESOLVED` is a **first-class signal** that carries semantic meaning: "This node was dirty and resolved without change." Downstream nodes can react to this signal without needing to recompute.

**2. Transitive memoization**

Push-phase memoization cascades:

```
A (value) → B (derived, equals) → C (derived, equals) → D (effect)

If A changes and B computes to the same value:
- B emits RESOLVED (not DATA)
- C receives RESOLVED, decrements dirty count
- If C had no other dirty deps, C emits RESOLVED (not DATA)
- D never re-runs, even though its direct dep C was dirty

Pull-phase can't do this — C would see B's unchanged value, compute its own value,
check equals, and still have to propagate the decision downward one step at a time.
```

**3. Clarity for downstream observers**

Push-phase gives downstream unambiguous information:
- `DIRTY` = "Upstream changed, value is uncertain"
- `DATA` = "New value is here"
- `RESOLVED` = "I was uncertain, but my value is the same"

Pull-phase leaves downstream guessing: "Did B decide not to propagate because equals fired, or because the subscription was untracked?"

### The Equals Option Design Space

The team also explored where `equals` should live:

**Option 1: Only on derived**
- Simpler API surface
- But tier 2 operators (debounce, throttle, etc.) also need memoization

**Option 2: On derived, producer, and operator**
- **Chosen.** Each store type handles `equals` appropriately:
  - `state(init, { equals })` — skip DIRTY propagation if value is equal
  - `derived([deps], fn, { equals })` — emit RESOLVED if computed value equals cache
  - `producer({ equals })` — skip emit if value is equal
  - `operator([deps], handler, { equals })` — emit RESOLVED if value is equal

### Why not auto-memoize all derived stores?

The team considered making RESOLVED the default behavior. Why not?

1. **Surprising behavior** — memoization is an optimization; developers should opt-in
2. **Performance cost** — every derived would need to cache + compare by default
3. **Semantic clarity** — when equals is absent, downstream has clear visibility: "All values are new"

By making `equals` optional, the default behavior is transparent.

### Interaction with Batch

The team verified that batch() and push-phase memoization compose correctly:

```ts
batch(() => {
  a.set(1);
  b.set(2);
})
// Phase 1: DIRTY propagates immediately (even in batch)
// Phase 2: DATA is deferred until batch ends
// RESOLVED is treated as part of phase 2 (deferred too)
// All at once: DAT phase resolves, all DEData/RESOLVED flow together
```

This ensures that memoization decisions don't get split across batch boundaries — the whole subtree settles together.

## REJECTED ALTERNATIVES

### 1. No memoization at all
- **Why rejected:** Loses optimization opportunity; libraries like Preact Signals and SolidJS show memoization matters for performance

### 2. Manual memoization via userland selectors
- **Why rejected:** Makes the library less ergonomic; library should provide the building block
- **Chosen approach:** Provide `equals` option; userland can compose selectors on top if needed

### 3. Always-memoize without opt-in
- **Why rejected:** Would break backward compatibility and make default behavior surprising (changes don't propagate sometimes?)

### 4. Memoization at the sink level (subscriber decides whether to recompute)
- **Why rejected:** Downstream doesn't know why upstream changed; inefficient (recompute first, then compare)

### 5. Pull-phase memoization with late equals check
- **Why rejected:** Requires double-computation pathway (eager + lazy); wastes resources

## KEY INSIGHT

**RESOLVED is a control signal, not a side effect.** The breakthrough was realizing that memoization shouldn't be a conditional "suppress the propagation" decision — it should be a **first-class signal** that informs the graph that "this node was dirty, but its output is identical to before." This allows:

1. **Transitive cascade** — entire downstream subtrees skip recomputation
2. **Semantic clarity** — DIRTY vs DATA vs RESOLVED are unambiguous
3. **Forward-compatible extensibility** — RESOLVED is one example; future signals like PAUSE/RESUME fit the same pattern
4. **Correct batching** — RESOLVED decisions are made once during the compute phase, then propagated atomically

The decision to use type 3 STATE channel for RESOLVED (instead of burying it in the DATA logic) was what made this work cleanly.

## FILES CHANGED

- `src/core/protocol.ts` — Added RESOLVED symbol
- `src/core/derived.ts` — Rewritten to:
  - Cache last computed value
  - Check `equals(lastValue, newValue)` during compute
  - Emit `RESOLVED` if equal, `DATA` if different
  - Forward RESOLVED to deps (allows transitive skipping)
- `src/core/producer.ts` — Added `equals` option support
- `src/core/operator.ts` — Added `equals` option support
- `docs/architecture-v2.md` / `docs/architecture-v3.md` — Documented two-phase push and RESOLVED semantics

---END SESSION---
