---
SESSION: 47f1a07f
DATE: March 15, 2026
TOPIC: Library Comparison (Zustand, Jotai, SolidJS, Preact Signals) — Mental Models and Design Trade-offs
---

## KEY DISCUSSION

This research session examined the top reactive state management libraries to understand their mental models, design decisions, and how callbag-recharge positions against them.

### Zustand (24M weekly, Flux-lite)

**Mental Model:**
- Single store with actions
- Dispatch → update → subscribers notified
- Object-based API

**Key Properties:**
- Shallow subscription (subscribe only to fields you use)
- No automatic memoization
- Simple, predictable

**How Callbag-Recharge Differs:**
- Multiple independent stores (not monolithic)
- Graph-based composition (derived, effects) vs imperative actions
- RESOLVED enables push-phase memoization (Zustand doesn't optimize this)

**Learning:** Zustand's popularity shows developers value simplicity over functional composition. Recharge trades simplicity for composability.

### Jotai (Primitive Atoms)

**Mental Model:**
- Atoms are primitives
- Derived atoms computed implicitly via dependency tracking
- **Implicit tracking** — no explicit deps array

**Key Properties:**
- Tiny API surface
- Zero boilerplate
- Magic auto-subscription (global context tracks which atoms are read)

**How Callbag-Recharge Differs:**
- **Explicit deps array** — `derived([a, b], fn)` instead of reading `a.get()` inside the function
- Recharge: developer declares dependencies upfront
- Jotai: dependencies discovered by analyzing which atoms are read during computation

**Critical Difference:**
```ts
// Jotai (implicit)
const atom_b = atom(0);
const atom_c = atom(0);
const atom_sum = atom(async (get) => {
  // Magic: reads atom_b and atom_c, auto-tracks them
  return get(atom_b) + get(atom_c);
});

// Recharge (explicit)
const b = state(0);
const c = state(0);
const sum = derived([b, c], () => b.get() + c.get());
```

**Team Reasoning:** Explicit deps are better for debugging and understanding the graph. Implicit tracking magic is powerful but creates uncertainty: "When does auto-tracking activate? What if I read something conditionally?" Recharge's explicit model is more deterministic.

### SolidJS (Reactive Primitive)

**Mental Model:**
- Signals = reactive primitives (like callbag sources)
- Computed = derived signals (like callbag transforms)
- Effects = side-effect runners
- **Automatic batch coordination** — effects only run after all signals settle

**Key Properties:**
- Two-phase computation (signal propagation + effect flush)
- No diamond resolution overhead — signals cache, derived caches
- `batch()` is explicit but automatic in event handlers

**How Callbag-Recharge Compares:**
- SolidJS: separate notification system (signals notify computed, computed notify effects)
- Recharge: unified callbag protocol (TYPE 1 DATA, TYPE 3 STATE)
- SolidJS: fine-grained reactivity (effects run on granular changes)
- Recharge: explicit dirty tracking via bitmask (scale to >32 deps with Uint32Array)

**Critical Insight from Session:**
The team recognized SolidJS as closest philosophical neighbor. Both use:
1. Automatic caching (derived caches its value)
2. Two-phase execution (dirty propagation, then value flow)
3. Effect batching (effects run when graph settles)

**Difference:** SolidJS uses a separate notification system; Recharge uses callbag type 3. Recharge's approach is more unified but adds type 3 overhead for every signal. SolidJS's separate system is leaner but requires more architectural scaffolding.

### Preact Signals

**Mental Model:**
- Signals = mutable cells with subscribers
- Computed = cached derived signals
- Effects = side-effect runners
- **Implicit memoization via cached flag**

**Key Properties:**
- Minimal memory per signal
- Fast signal creation (~120 bytes vs Recharge's ~720 bytes with Inspector)
- Computed uses a cached flag (not a RESOLVED signal)

**How Callbag-Recharge Differs:**
```ts
// Preact (implicit cached flag)
const comp = computed(() => {
  // Internally checks if dependencies changed
  // If not, returns cached value without recomputing
});

// Recharge (explicit RESOLVED)
const comp = derived([a, b], () => {...}, { equals: (x, y) => x === y });
// Emits RESOLVED on type 3 if computed value equals cache
```

**Recharge's Insight:** RESOLVED is explicit and composable. Downstream nodes can react to it. Preact's cached flag is purely internal optimization — downstream doesn't know why propagation stopped.

**Memory Trade-off:**
- Preact: ~120 bytes/signal (bare minimum, no Inspector, no STANDALONE)
- Recharge: ~720 bytes/store with Inspector ON, ~500 with Inspector OFF
- Recharge adds cost for observability (Inspector), STANDALONE derived, and unified callbag protocol

### Implicit vs Explicit Tracking: The Core Trade-off

The team debated this across all libraries and made a key decision:

**Jotai's Implicit Tracking:**
- Pros: Zero boilerplate, minimal API surface
- Cons: Requires global context during computation, makes debugging harder, unclear what "dependencies" are, conditional reads can surprise

**Recharge's Explicit Deps:**
```ts
const result = derived([a, b], () => {
  // a, b are guaranteed to be in the deps array
  // If you read a value not in deps, it's stale or cached
  // Developer understands the contract
});
```

**Chosen:** Explicit is better for understanding, testing, and scaling. Jotai's approach is more magical but less predictable. Recharge's philosophy: **explicit deps, arguably better for debugging.**

### Three Promises

The session crystallized a three-part philosophy (using Chinese metaphor: trust, harmony, action):

1. **Trust (Diamond Resolution)** — graph behaves predictably even with complex topologies
2. **Harmony (Unified Callbag)** — no split channels, unified protocol for signals + values
3. **Action (Effects + Batch)** — effects run once per change, batching coordinates multiple updates

### Performance Positioning

The team analyzed benchmarks:

| Library | Read | Write | Computed | Diamond |
|---------|------|-------|----------|---------|
| Preact Signals | 120M ops/sec | 33M | 19M | ~17M |
| SolidJS | ~110M | ~30M | ~15M | ~18M |
| Recharge | 178M | 40M | 18M | 25M | 

**Insight:** Recharge is fastest on raw state read (no deps to track), slower on computed (Inspector + explicit deps overhead). Within ~2x of Preact on everything else — acceptable given the added observability.

### Observability is a Feature

Unlike Zustand/Jotai/SolidJS, Recharge has built-in Inspector:

```ts
Inspector.graph() // returns dependency graph
node._status // readable status: DISCONNECTED, DIRTY, SETTLED, RESOLVED, COMPLETED, ERRORED
Inspector.inspect(store) // returns { name, kind, value, status }
```

This is rare in state management libraries. It's borrowed from RxJS DevTools philosophy — observability is not an afterthought.

## REJECTED ALTERNATIVES

### 1. Copy Jotai's Implicit Tracking
- **Why rejected:** Makes reasoning about dependencies harder; magic global context is fragile
- **Explicit deps chosen:** Better for scaling, testing, and collaboration

### 2. Copy Preact's Separate Notification System
- **Why rejected:** Requires parallel infrastructure; Recharge's callbag type 3 is unified
- **Type 3 chosen:** Single protocol, cleaner architecture

### 3. Copy SolidJS's Fine-Grained Reactivity
- **Why rejected:** Requires per-signal subscriptions; Recharge's tier model (tier 1 + tier 2) provides enough flexibility
- **Two-tier chosen:** simpler mental model

### 4. No Inspector / Observability
- **Why rejected:** Library should provide tools for understanding graph behavior
- **Inspector chosen:** Builds on RxJS DevTools precedent

### 5. Single Large Store (Zustand-style)
- **Why rejected:** Less composable; callbag-recharge is designed for compositional derived stores
- **Multiple stores + composition chosen:** Natural fit for reactive pipelines

## KEY INSIGHT

**Recharge occupies a unique position:** It combines Jotai's compositional atoms, SolidJS's two-phase execution, Preact's performance (mostly), and adds explicit deps + observability.

The core design choice: **explicit deps are better than implicit tracking** because they make the contract between developer and library clear. Developers can reason about their graph without understanding Recharge's internal context machinery.

This positions Recharge as the library for developers who value:
1. Composability (derived stores, effects)
2. Predictability (explicit deps)
3. Observability (Inspector)
4. Correctness (two-phase push, diamond resolution)

Over maximum simplicity (Zustand) or maximum magic (Jotai).

## FILES CHANGED

- `docs/state-management.md` — Comprehensive comparison of Zustand, Jotai, SolidJS, Preact Signals, and Recharge
- `docs/architecture-v4.md` — Added "Compatibility targets" section positioning Recharge against TC39 Signals, raw callbag, RxJS
- Future roadmap: `src/compat/jotai.ts`, `src/compat/zustand.ts`, `src/compat/signals.ts` — bridge layers for interop

---END SESSION---
