---
title: "Stores All the Way Down: Adding State to Reactive Programming"
description: "Why callbag-recharge wraps every source in a Store interface and how get/set/source unlock practical reactive programming beyond pure streams."
date: 2026-03-25
author: David Chen
outline: deep
---

# Stores All the Way Down: Adding State to Reactive Programming

*Chronicle 23 - Arc 7: From Library to Platform*

Streams are great at movement. Apps also need memory.

That tension drove one of our biggest platform decisions: every reactive node should expose state directly, not just events. In callbag-recharge, that becomes a simple interface:

- `get()` for current value
- `set()` for controlled writes
- `source()` for callbag-native composition

## Why plain streams were not enough

Pure stream APIs are elegant until product code asks practical questions:

- "What is the current value right now?"
- "Can I set an optimistic value before async work returns?"
- "Can UI, orchestration, and persistence all reference one object?"

Without a stateful surface, teams bolt on side stores and caches. You end up with two systems: one reactive graph and one imperative state layer.

## The Store contract as a bridge

The Store interface unifies those worlds:

1. **Pull now** with `get()` when needed by UI or logic.
2. **Push updates** with `set()` in explicit mutation points.
3. **Compose reactively** with `source()` everywhere else.

This keeps callbag semantics intact while giving app code predictable state access.

## Platform effect

Once all primitives speak Store, higher layers become straightforward:

- adapters can load/save against a stable state shape
- compat wrappers can mirror familiar APIs (like Zustand-style stores)
- orchestration flows can coordinate around explicit status stores

You are no longer building "a stream library plus glue." You are building a coherent state platform.

## Trade-off we accepted

Yes, exposing `set()` invites misuse if teams mutate everything from everywhere.

The fix is architectural discipline, not hiding capability:

- keep mutation boundaries explicit
- derive wherever possible
- treat `set()` as a domain action, not random assignment

## Takeaway

Reactive programming becomes practical at scale when state is first-class, not an afterthought.

`get()/set()/source()` looks small. It is the decision that let callbag-recharge move from library internals to platform architecture.
