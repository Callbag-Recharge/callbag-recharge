---
title: "The Cost of Correctness: 9.8M ops/sec vs Preact's 34M"
description: "An honest benchmark post on why callbag-recharge accepts lower peak ops/sec in exchange for stronger graph correctness guarantees under complex reactive workloads."
date: 2026-03-25
author: David Chen
outline: deep
---

# The Cost of Correctness: 9.8M ops/sec vs Preact's 34M

*Chronicle 21 - Arc 6: Correctness Stories*

At one point we measured roughly `9.8M ops/sec` where Preact-style signal benchmarks showed around `34M`.

It is tempting to hide that number. We published it.

## Why the numbers differ

Benchmarks are not neutral. They encode assumptions.

Our engine pays for guarantees that many microbenchmarks do not model:

- explicit dependency graph semantics
- lifecycle signal propagation (reset/cancel/pause paths)
- diamond-safe coordination under composition
- inspector visibility and deterministic control flow

Those guarantees cost cycles. They also prevent classes of production bugs.

## What "faster" can mean

A lean signal core optimized for trivial fan-out can dominate synthetic throughput. That is a valid design target.

But if your workload includes orchestration, cancellation, dynamic branches, and observable control state, peak scalar throughput is not the only metric that matters.

## Our stance

We optimize hard inside our semantic contract. We do not relax the contract to win one chart.

That means:

- aggressively improving representation and memory layout
- removing avoidable protocol complexity
- keeping correctness behavior explicit and testable

But it does **not** mean deleting safety properties because they are inconvenient to benchmark.

## How to evaluate us fairly

When comparing reactive runtimes, ask:

1. What guarantees are included in the measured path?
2. How does the system behave under cancellation and switching?
3. Are lifecycle/control semantics visible and composable?
4. What fails first under graph complexity: speed or correctness?

A single ops/sec number cannot answer those.

## Takeaway

The honest benchmark is not the one where you win. It is the one where users understand the trade-off.

We are building for correctness-first reactive orchestration. If that costs raw peak throughput in minimal scenarios, that is a deliberate engineering choice, not an accident.
