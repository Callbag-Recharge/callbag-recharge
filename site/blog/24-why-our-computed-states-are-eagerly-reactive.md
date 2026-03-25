---
title: "Why Our Computed States Are Eagerly Reactive"
description: "A design deep dive into STANDALONE mode: why callbag-recharge computes eagerly for correctness and predictable orchestration behavior."
date: 2026-03-25
author: David Chen
outline: deep
---

# Why Our Computed States Are Eagerly Reactive

*Chronicle 24 - Arc 7: From Library to Platform*

Lazy computed values look efficient. They can also hide work until inconvenient moments.

We chose eager reactivity for computed stores in core flows, especially in STANDALONE mode, because orchestration correctness depends on predictable update timing.

## The lazy trap

Lazy computed models defer work until someone reads the value. In UI-only scenarios that can be fine. In orchestration-heavy graphs it creates ambiguity:

- did this dependency actually settle yet?
- is this branch idle or just unread?
- did cancellation happen before computation even started?

Those timing ambiguities are painful in control-sensitive pipelines.

## Why eager helps

Eager computation gives deterministic behavior:

- dependencies update, computation runs
- status changes are observable immediately
- downstream nodes do not "wake up late" on first read

That makes control signals like reset/cancel easier to reason about and easier to test.

## STANDALONE mode and platform guarantees

STANDALONE mode strengthened this decision. When nodes can operate independently, hidden lazy work becomes a bigger source of surprise.

Eager semantics preserve a simple contract: if upstream changed and the node is active, the computed state is current now.

## Performance concerns

Eager does not mean "compute everything always."

We still optimize with:

- topology-aware propagation
- subtree skipping through RESOLVED-style control signals
- sparse memory structures and packed flags

So the choice is not eager vs fast. It is eager plus disciplined optimization.

## Takeaway

We prioritized predictability over clever deferred execution.

In a platform meant for UI, orchestration, and AI workflows, eager computed state is the safer default because it makes system behavior explicit at the moment changes occur.
