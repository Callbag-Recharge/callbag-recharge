---
title: "Data Should Flow Through the Graph, Not Around It"
description: "Our first architecture split callbag for wiring from get() for values. v2's aha moment: unify transport — two phases on one channel — so the protocol stays honest."
date: 2026-03-24
author: David Chen
outline: deep
---

# Data Should Flow Through the Graph, Not Around It

*Arc 3, Post 7 — Architecture v2: The Great Unification*

---

Callbag was already doing the hard work: **talkback**, explicit sinks, a graph you could reason about. In our first architecture pass, we still treated it like a **notification bus** while the real numbers moved through a side door.

**DIRTY** rode callbag's DATA channel. **Values** rode `store.get()`, which walked the dependency chain and pulled fresh results. It worked — diamonds resolved, effects batched — but the shape of the system said something awkward: *the graph is for invalidation; the truth is elsewhere.*

This post is the v1 → v2 turning point: why that split stopped feeling like a feature and started feeling like debt, and why we chose **two-phase push on a single transport** instead of copying Preact Signals' lazy refresh model wholesale.

## The context: callbag without values

In v1, mental model was clean on paper:

- **Push:** Flood downstream with a sentinel when something changed.
- **Pull:** Recompute when code asked for a value.

We told that story in [Push Dirty, Pull Values](./04-push-dirty-pull-values-our-first-diamond-solution). The **pull chain** was the diamond resolver: `D.get()` forced `B` and `C` to settle before `D` combined them.

The catch: **callbag never carried ordinary state updates as the primary path.** Pipes and effects subscribed to sources, but if you wanted "what is this derived right now?", you did not subscribe — you **called get()**. Callbag wired the topology; `get()` was a parallel world.

That is not wrong as a hack. It is incomplete as a **protocol story**. Every other operator ecosystem eventually asks: *does data flow through the pipe, or around it?*

## The pitfall: elegance vs honesty

Dual-channel designs are everywhere — Preact Signals and Solid lean on **notify + lazy recompute** patterns that separate "you are stale" from "here is the new value." We could have mirrored that: keep DIRTY on the reactive spine, add proper **caching** on derived nodes, and let `get()` trigger refresh like they do.

We seriously considered it. Lazy refresh is battle-tested, easy to explain, and familiar to anyone coming from signals.

We still moved to **two-phase push** instead:

1. **Phase 1 — DIRTY:** Same as v1. Cheap fan-out; nodes count which upstream deps are pending.
2. **Phase 2 — Values:** Sources emit real values through the **same** sinks. Derived nodes buffer until every dirty dep has delivered, then compute **once**, cache, and emit downstream.

Why? Because it keeps a single rule: **what the graph subscribes to is what the graph delivers.** Batch coalescing, operator fusion, and test assertions over emission order all stay on one mechanism. `get()` becomes a read of cached state (with a narrow escape hatch while a node is pending — we document that in the archived v2 spec), not the hidden highway for every value.

## The insight: unification is not "more magic"

Two-phase push sounds more complex than "push dirty, pull values." In some ways it is — you now have **pending counts** and a second wave after depth returns to zero.

But **unification removed a whole class of rationalizations:** you no longer defend why the library uses callbag "for wiring only." The protocol carries both the invalidation story and the value story. Extras that forward DIRTY and forward transformed values are participating in the **same** contract core uses, not bolting a mini-scheduler on top.

That matters when you add **batch()**, **equals**, and operators like **combine**: the diamond case stops being "pull ordering luck" and becomes "**wait until all dirty deps have reported**, then compute."

## What we kept from v1

None of this threw away v1's wins:

- **Explicit dependencies** — still arrays and explicit subscriptions, not auto-tracking magic.
- **Diamond safety as a graph property** — still counting and ordering, not framework batching prayers.
- **Depth tracking and flush points** — phase 2 still waits until phase 1 quiesces.

We changed the **carrier**, not the **values** (pun intended): one spine, two beats per tick.

## Further reading

- [Push Dirty, Pull Values: Our First Diamond Solution](./04-push-dirty-pull-values-our-first-diamond-solution) — the dual-channel baseline this post reacts to
- [Two-Phase Push: DIRTY First, Values Second](./08-two-phase-push-dirty-first-values-second) — the protocol in detail
- [Architecture & design](/architecture/) — today's canonical design (evolved again with type 3 and beyond)
- Historical spec: `src/archive/docs/architecture-v2.md` — full v2 rationale, comparison tables, migration notes

---

*Next in Arc 3: [Two-Phase Push: DIRTY First, Values Second](./08-two-phase-push-dirty-first-values-second).*
