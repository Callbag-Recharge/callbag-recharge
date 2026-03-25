---
title: "When We Removed the ADOPT Protocol"
description: "A simplification story from architecture v4: removing ADOPT reduced internal surface area, eliminated edge-case state transitions, and made control flow easier to reason about."
date: 2026-03-25
author: David Chen
outline: deep
---

# When We Removed the ADOPT Protocol

*Chronicle 15 - Arc 5: Architecture v4 - Performance Without Compromise*

ADOPT started as a clever mechanism. It let nodes negotiate ownership-like transitions during dynamic graph changes. It also made the system harder to reason about than it needed to be.

By v4, ADOPT had become one of those "just in case" protocols that cost us every day:

- more branches in lifecycle paths
- more intermediate states to test
- harder debugging when control signals interacted with rewiring

So we removed it.

## Why ADOPT looked good on paper

In theory, ADOPT gave us a formal step to coordinate graph handoffs. In practice, it duplicated guarantees we already had from:

- explicit dependency wiring
- Type 3 control signal propagation
- deterministic subscribe/unsubscribe semantics

We had two mechanisms enforcing similar invariants. That is usually a smell.

## What changed after removal

Without ADOPT, handoff logic became boring:

1. unsubscribe old edge
2. subscribe new edge
3. rely on existing signal propagation to coordinate state

No separate protocol branch, no special transition records, no "is this node adopted yet?" checks.

## Performance impact

The direct gain was not dramatic in one benchmark. The compounding effect was:

- fewer objects created in orchestration-heavy paths
- fewer control-flow branches in hot update loops
- less code inlining pressure for V8

That translated into better consistency rather than headline max throughput. Tail latency and predictability improved.

## Correctness impact

Simpler state machines are easier to test exhaustively.

By dropping ADOPT we reduced:

- impossible-but-representable internal states
- race windows between handoff markers and actual subscriptions
- places where cleanup could be skipped on cancel/reset

The test matrix got smaller and stronger at the same time.

## Broader lesson

A protocol should survive because it is necessary, not because it is elegant.

When a design element overlaps existing guarantees, remove it and measure again. In our case, deleting ADOPT was not just cleanup. It clarified what truly carries correctness in this architecture: graph topology plus callbag signals, end to end.
