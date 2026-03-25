---
title: "Why Control Signals Don't Belong in the Data Stream"
description: "Type 1 carries values; type 3 carries coordination. Mixing them breaks receivers, extensibility, and the guarantee that DATA is always real user data."
date: 2026-03-24
author: David Chen
outline: deep
---

# Why Control Signals Don't Belong in the Data Stream

*Arc 4, Post 11 — Architecture v3: The Type 3 Breakthrough*

---

Reactive libraries need two different conversations at once: **“something may change”** (control) and **“here is the next value”** (data). If both use the same envelope, every operator becomes a classifier — *is this payload or prelude?* — and the simplest `map` is wrong twice.

callbag-recharge’s rule after v3 is blunt:

1. **Type 1 DATA carries only real values.** No sentinels, no `undefined` as “I am dirty,” no parallel vocabulary hiding inside the value stream.
2. **Type 3 STATE carries DIRTY, RESOLVED, and unknown signals** that must propagate downstream unless a node has a deliberate, documented reason to absorb them.
3. **DIRTY before DATA, always** — phase one establishes *pending*; phase two delivers DATA or RESOLVED.

This is not purism. It is **receiver ergonomics**. A sink that only implements DATA + END can still attach to a store; a tier-2 wrapper that uses `subscribe()` and only observes values is not forced to understand graph coordination — yet tier-1 nodes still participate in diamond resolution because they see the full protocol.

## Extensibility without version churn

Unknown **STATE** signals forward by default. That is how we avoid another “flag day” when we add PAUSE, RESUME, or lifecycle verbs: intermediates pass what they do not understand, and only nodes with explicit handling change behavior.

If those lived on DATA, every `map`/`filter`/`scan` would need a default branch for “not actually data,” or the ecosystem would fracture into wrapped value types.

## Suppression is not silence

When a transform decides **not** to emit a new value (filter rejects, `distinctUntilChanged` sees equality), v3 does not “emit nothing.” Silence after a forwarded DIRTY leaves downstream bitmasks stuck. **RESOLVED** is the phase-two message that means: *the pending wave is over; nothing new on the wire.*

So control is not only “before values” — **RESOLVED is part of the same vocabulary** as DATA, but still on STATE, not masquerading as a value.

## Tier boundaries stay honest

Tier-2 nodes (async timers, inner subscriptions) do not see upstream DIRTY/RESOLVED the same way tier-1 nodes do — they start fresh cycles via `autoDirty` and producer semantics. **Separating DATA from STATE** keeps that boundary visible in the spec: tier-1 speaks full protocol; tier-2 bridges imperatively at the edges without pretending async is the same shape as sync transforms.

## Further reading

- [The Day We Read the Callbag Spec (Again)](./10-the-day-we-read-the-callbag-spec-again) — how type 3 landed
- [RESOLVED: The Signal That Skips Entire Subtrees](./12-resolved-the-signal-that-skips-entire-subtrees) — what RESOLVED does to downstream work
- Archived spec: `src/archive/docs/architecture-v3.md` (sections 1–4)
- [Architecture](/architecture/) — §1 invariants (DATA vs STATE)

---

*Next: [RESOLVED and subtree skipping](./12-resolved-the-signal-that-skips-entire-subtrees).*
