---
title: "From Zustand to Reactive Orchestration"
description: "How compatibility wrappers let teams adopt callbag-recharge incrementally: keep familiar store ergonomics while gaining graph-level orchestration."
date: 2026-03-25
author: David Chen
outline: deep
---

# From Zustand to Reactive Orchestration

*Chronicle 25 - Arc 7: From Library to Platform*

Most teams cannot rewrite state architecture in one sprint.

That is why we built compatibility wrappers: start with familiar store ergonomics, then progressively adopt richer reactive orchestration without breaking app code.

## Migration reality

A typical Zustand codebase already has:

- centralized store setup
- selector-driven reads
- imperative action methods

Asking teams to jump directly into new primitives is a non-starter. The wrapper strategy meets them where they are.

## What the wrapper does

The compat layer maps known patterns onto callbag-recharge internals:

- Zustand-style creation APIs map to Store primitives
- selectors and subscriptions map to reactive sources
- actions remain explicit mutation boundaries

Under the hood, teams now get graph-aware propagation and composable lifecycle signals.

## Why this is more than syntax sugar

The key upgrade is architectural:

- from isolated state slices to connected dataflow
- from ad hoc async logic to orchestrated reactive pipelines
- from opaque updates to inspectable graph behavior

You keep adoption friction low while changing what is possible.

## Practical rollout pattern

Successful migrations usually follow:

1. replace store creation with compat wrapper
2. keep existing actions/selectors stable
3. move async flows into reactive operators/orchestrate nodes
4. gradually replace wrapper surfaces with native primitives where beneficial

This lets teams de-risk gradually and measure value at each step.

## Takeaway

Compatibility is not compromise when it is designed as a bridge.

For callbag-recharge, wrappers are a platform strategy: reduce migration pain now, unlock orchestration capability later.
