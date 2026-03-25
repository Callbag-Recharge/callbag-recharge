---
title: "The Day We Read the Callbag Spec (Again)"
description: "Callbag already had four message types. We had been squeezing DIRTY into DATA as sentinels — until we used the unused fourth type for real control signals."
date: 2026-03-24
author: David Chen
outline: deep
---

# The Day We Read the Callbag Spec (Again)

*Arc 4, Post 10 — Architecture v3: The Type 3 Breakthrough*

---

Everyone quotes the callbag handshake. Fewer people linger on the fourth argument to `sink`.

In v2 we had already moved **DIRTY** onto the wire — but we were still treating it like *data-shaped noise*: special values riding **type 1 DATA**, while “real” outputs were often pulled through **`.get()`** on the side. It worked. It was also a category error. **Callbag is the wiring layer.** If half the story lives in push signals and the other half in imperative reads, you split the debugger, the Inspector, and your own mental model.

So we opened the spec again. The protocol already lists four types:

- **START (0)** — handshake
- **DATA (1)** — payload
- **END (2)** — completion or error
- **Custom (3)** — *reserved for extensions*

That last line was the unlock. We were not inventing a parallel protocol. We were **using the extension slot for what it was for**: control semantics that are not user values.

## The breakthrough in one sentence

**Put DIRTY, RESOLVED, and future lifecycle signals on type 3 STATE; keep type 1 DATA for real values only.**

That single separation implies the rest: two-phase push (prepare, then commit or resolve), bitmask diamond resolution, forward-compatible passthrough of unknown STATE signals, and a hard rule that **type 1 never carries sentinels** — so any consumer that only understands DATA still sees a trustworthy stream of values.

## Why we did not keep “DIRTY as DATA”

Mixing control and payload on one channel forces every receiver to ask: *is this my next value, or is it a coordination message?* Libraries end up with `undefined`-as-signal hacks, duplicate equality checks, and debugging stories that start with “it looked like a value.”

A dedicated STATE channel makes the question disappear. **DATA is always data.** STATE is always “how to interpret what comes next.” Downstream nodes can implement the protocol fully; raw callbag sinks can still subscribe and receive only type 1.

## What changed in the codebase

We codified **STATE = 3** with **DIRTY** and **RESOLVED** symbols, wired **producer** as the universal source primitive with `emit` / `signal` / `complete` / `error`, and taught **operator**, **derived**, and **effect** to forward STATE (especially unknown STATE) instead of swallowing it — so PAUSE, RESUME, or future control verbs can travel without another breaking redesign.

This was not a cosmetic rename. It was the moment v2’s “dual channel in spirit” became **one callbag-shaped spine** for both coordination and values.

## Further reading

- [Why Control Signals Don't Belong in the Data Stream](./11-why-control-signals-dont-belong-in-the-data-stream) — the invariants we adopted after the split
- [Two-Phase Push: DIRTY First, Values Second](./08-two-phase-push-dirty-first-values-second) — the v2 bridge into v3
- [Architecture](/architecture/) — current protocol and folder rules
- Session notes: `src/archive/docs/SESSION-8452282f-type3-breakthrough.md`

---

*Next: [Why control signals don't belong in the data stream](./11-why-control-signals-dont-belong-in-the-data-stream).*
