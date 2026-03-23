---
layout: doc
---

# Compat Comparison

Same counter app in four state management APIs — all backed by callbag-recharge's reactive engine.

**Try it:** Click the +/- buttons in each column. All four counters are independent but use the same underlying reactive primitives.

<ClientOnly>
  <CompatComparison />
</ClientOnly>

## What it demonstrates

| API | Module | How it maps |
|-----|--------|-------------|
| **callbag-recharge** | `core` | `state()` + `derived()` — native API |
| **Jotai** | `compat/jotai` | `atom()` wraps `state()`, derived atoms wrap `dynamicDerived()` |
| **Zustand** | `compat/zustand` | `create()` wraps `state()` with Zustand's `set`/`get` contract |
| **TC39 Signals** | `compat/signals` | `Signal.State` wraps `state()`, `Signal.Computed` wraps `derived()` |

## How it works

Each compat layer is a thin wrapper (~30-80 lines) that translates a familiar API into callbag-recharge primitives. The reactive engine is identical — same diamond resolution, same batching, same performance.

This means you can:
- Migrate from Jotai/Zustand without rewriting everything at once
- Use the API style your team prefers
- Get callbag-recharge's operator ecosystem on any compat store

All tree-shakeable. Zero framework lock-in.
