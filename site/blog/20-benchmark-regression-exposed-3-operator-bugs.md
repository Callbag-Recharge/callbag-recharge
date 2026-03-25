---
title: "Benchmark Regression Exposed 3 Operator Bugs"
description: "A regression benchmark became a correctness detector: three operator bugs surfaced only under sustained workload pressure."
date: 2026-03-25
author: David Chen
outline: deep
---

# Benchmark Regression Exposed 3 Operator Bugs

*Chronicle 20 - Arc 6: Correctness Stories*

Most teams treat benchmarks as speed scoreboards. We started using them as behavior amplifiers.

One regression run did not just show "slower." It exposed three distinct operator correctness bugs.

## Why benchmarks found what tests missed

Unit tests validate expected scenarios. Benchmarks stress repetition, timing, and composition:

- long-running operator chains
- rapid source churn
- back-to-back lifecycle transitions

Under that pressure, tiny state bugs become obvious quickly.

## Bug class #1: stale branch cleanup

An operator path kept stale branch references after rapid switching. Throughput drop was the symptom; leaked active work was the cause.

## Bug class #2: completion edge handling

A clean END path in one composed operator sequence skipped expected downstream cleanup. In short tests it passed; in repeated loops it accumulated inconsistent state.

## Bug class #3: cancellation asymmetry

Cancellation from one side of a composed pipeline was not mirrored consistently across nested subscriptions. This showed up as occasional late emissions after supposed teardown.

## What we changed

Beyond fixing bugs, we changed process:

- kept regression benches in CI checks for behavior deltas
- added invariants to benchmark harness output, not just ops/sec
- paired each bug fix with a focused deterministic unit test

Benchmarks catch the smoke. Unit tests lock in the fix.

## Takeaway

Performance tests are excellent at finding correctness bugs in reactive systems because they maximize state transitions per second.

If a benchmark graph slows down unexpectedly, ask "what became incorrect?" before asking "what became expensive?"
