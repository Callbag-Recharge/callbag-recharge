---
title: "Bitmask Overflow at More Than 32 Dependencies"
description: "A deep debugging story on the >32 dependency edge case: how bitmask assumptions failed and what changed to preserve correctness at scale."
date: 2026-03-25
author: David Chen
outline: deep
---

# Bitmask Overflow at >32 Dependencies

*Chronicle 29 - Arc 8: Engineering Deep Cuts*

Bitmasks are fast. JavaScript bitwise operations are 32-bit. That mismatch eventually catches up.

We hit the edge case when dependency counts exceeded 32 in stress tests. Behavior degraded from subtle mis-tracking to obvious correctness failures in extreme graphs.

## The hidden assumption

Initial flag math implicitly assumed all tracked dependency bits would fit a single 32-bit lane.

That assumption held in most practical examples, so the bug slept quietly until broad test matrices pushed arity higher.

## Symptoms

Beyond the threshold, we observed:

- false positives in dependency readiness
- false negatives in invalidation tracking
- inconsistent branch behavior under combined fan-in updates

None of this was acceptable, even if "rare."

## The fix strategy

We moved from single-lane assumptions to scalable representation choices for high-arity paths while preserving fast paths for normal cases.

Key principles:

- keep common <=32 dependency paths optimized
- branch to overflow-safe handling only when needed
- back all thresholds with explicit tests

This kept performance where it matters and correctness where it must.

## Testing upgrade

The dedicated high-arity suite became permanent. Edge-case correctness is now treated as a first-class contract, not an optional stress add-on.

## Takeaway

Fast-path assumptions are fine until they become invisible constraints.

If your core data model has hard limits, make them explicit in code and tests before users discover them in production.
