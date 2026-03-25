---
title: "Five Primitives, Two Tiers, Zero Schedulers"
description: "producer, state, derived, operator, effect — plus tier 1 vs tier 2 boundaries. Effects run inline; there is no global reactive scheduler."
date: 2026-03-24
author: David Chen
outline: deep
---

# Five Primitives, Two Tiers, Zero Schedulers

*Arc 4, Post 13 — Architecture v3: The Type 3 Breakthrough*

---

The core API is intentionally small. **Five names** cover how data enters the graph, transforms, and exits:

| Primitive | Role |
| --- | --- |
| **producer** | Generic callbag source — `emit`, `signal`, lifecycle |
| **state** | Ergonomic producer — `set` / `update`, TC39-friendly `equals` |
| **operator** | Multi-dep transform with full STATE + DATA handler |
| **derived** | `operator` shaped as “computed store” sugar |
| **effect** | Terminal sink — runs when deps resolve, no downstream store |

**dynamicDerived** fits beside **derived**: same operator lineage, but dependencies are discovered at runtime via tracking reads — still a transform, not a sixth *conceptual* axis (source / transform / sink).

## Two tiers: where STATE stops

- **Tier 1** — synchronous transforms, static dependency lists, full DIRTY / RESOLVED / DATA protocol. Use **operator** (or **derived**). Diamond resolution and bitmask logic live here.
- **Tier 2** — timers, promises, inner subscriptions, dynamic upstream. Use **producer** with **`autoDirty: true`** and imperative `subscribe()` inside the producer body. Tier-2 nodes start **fresh DIRTY+DATA cycles** per emission; they do not inherit upstream two-phase STATE the same way tier-1 nodes do.

The split is how we keep **RxJS-shaped** async operators without pretending they are the same animal as a pure `map`. Async boundaries are **producer-shaped**; sync graph logic stays **operator-shaped**.

## Zero schedulers

There is **no `enqueueEffect`**, no global tick, no `queueMicrotask` layer deciding order. When all dirty deps of an **effect** have resolved (DATA or RESOLVED), the effect function runs **inline**, synchronously, in the same call stack as the resolution — same rule as in our architecture doc’s performance story: **deterministic ordering**, glitch-friendly batching, and no hidden microtask priority inversions.

For single-dep reactions that do not need DIRTY/RESOLVED bookkeeping, **subscribe** stays the lightweight DATA sink (see architecture §1.19).

## One producer base

**state** is not a parallel implementation — it rides **producer** with defaults users expect (`Object.is`, `set(same)` no-op semantics). **producer** unifies “event stream,” “async boundary,” and “bare metal source” so we are not maintaining three competing source classes.

## Further reading

- [RESOLVED: The Signal That Skips Entire Subtrees](./12-resolved-the-signal-that-skips-entire-subtrees) — how tier-1 nodes finish waves
- [The Inspector Pattern](./06-the-inspector-pattern-observability-as-first-class-citizen) — observability without changing the five primitives
- [Architecture](/architecture/) — roles, tiers, and `subscribe` vs `effect`
- Archived: `src/archive/docs/architecture-v3.md` — rules 1–3 for picking primitives

---

*Chronicle continues with [Output Slot: How null->fn->Set Saves 90% Memory](./14-output-slot-how-null-to-fn-to-set-saves-90-percent-memory) — our first Arc 5 deep dive.*
