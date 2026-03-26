---
title: "The Protocol That Already Solved Your Problem"
description: "Callbag's 4-type system — START, DATA, END, STATE — is a complete vocabulary for reactive programming. Here's why protocol-first design beats API sugar."
date: 2026-03-21
author: David Chen
outline: deep
---

# The Protocol That Already Solved Your Problem

*Arc 1, Post 2 — Origins: Why Revive Callbag?*

---

Most reactive libraries start with an API. You get `Observable`, `Signal`, `Atom`, `Store` — a set of classes or functions that encode a specific model of reactivity. The protocol is an implementation detail, hidden behind the public surface.

Callbag starts with a protocol. The API is whatever you build on top.

This sounds like an academic distinction. It's not. It's the reason callbag-recharge can unify state management, stream processing, and workflow orchestration in a single library — while Signals, RxJS, and Zustand each occupy their own silo.

## The four types

Callbag's protocol uses four message types:

```ts
type Callbag = (type: 0 | 1 | 2 | 3, payload?: any) => void;
```

| Type | Name | Direction | Purpose |
|------|------|-----------|---------|
| 0 | START | Both | Handshake — source and sink exchange references |
| 1 | DATA | Downstream | Carry real values |
| 2 | END | Both | Termination — completion or error |
| 3 | STATE | Downstream | Control signals — DIRTY, RESOLVED, and future extensions |

Type 0, 1, and 2 come from the [original callbag spec](https://github.com/callbag/callbag). Type 3 is our extension — and the key to solving problems that other reactive systems punt on.

## How the handshake works

Every callbag interaction starts with a START handshake:

```ts
// Sink wants to subscribe to source
source(0, sink);

// Source acknowledges and sends a talkback
// (inside source's type-0 handler)
sink(0, talkback);
```

After the handshake, both sides hold a reference to each other. The source can push data downstream via `sink(1, value)`. The sink can signal upstream via `talkback(2)` to unsubscribe.

This bidirectional setup is what makes callbag more expressive than a simple event emitter. The talkback channel enables:

- **Cancellation**: `talkback(2)` tears down the subscription
- **Pull semantics**: `talkback(1)` can request the next value (for async iterables, backpressure)
- **Resource cleanup**: Sources know exactly when they lose their last subscriber

No separate `Subscription` object. No `.unsubscribe()` method on a return value. The protocol handles it.

## Why type 1 must carry only real values

In our v1 architecture, we made a mistake that many reactive libraries make: we sent control signals on the data channel.

```ts
// v1: DIRTY was a sentinel on type 1
sink(1, DIRTY);  // "something changed upstream"
sink(1, value);  // "here's the new value"
```

This worked, but it broke a fundamental expectation. If you write a `map()` operator, it should transform every value it receives:

```ts
const doubled = map(x => x * 2)(source);
```

But what happens when `DIRTY` arrives on type 1? The map function receives `DIRTY` as `x`, tries to compute `DIRTY * 2`, and produces `NaN`. Every operator needs special-case handling for sentinel values. Every new signal you add means auditing every operator in the library.

The fix was obvious in retrospect: **type 1 is for data, type 3 is for control signals**. They're separate channels. Operators that don't understand a type 3 signal forward it unchanged — future-proofing for free.

```ts
// v3+: Clean separation
sink(3, DIRTY);     // Control channel: "value is about to change"
sink(1, newValue);  // Data channel: "here's the new value"
sink(3, RESOLVED);  // Control channel: "I was dirty, but value didn't change"
```

This is the architectural insight that everything else builds on. Every operator passes type 3 signals through by default. New signals (PAUSE, RESUME, custom domain signals) work without touching existing code.

## Two-phase push: the diamond killer

The diamond problem is reactive programming's classic correctness bug:

```
     A
    / \
   B   C
    \ /
     D
```

When A changes, both B and C recompute. D depends on both. If D sees B's new value but C's old value, it computes with inconsistent state — a **glitch**.

Signals solve this with topological sorting or lazy evaluation. RxJS punts on it entirely (use `combineLatest` and accept the intermediate emission). We solve it with two-phase push on the protocol level.

**Phase 1 — DIRTY propagation (type 3):**
When `A.set(5)` is called, `DIRTY` propagates through the entire downstream graph instantly and synchronously. No values are computed. Every node just learns "something upstream changed."

```
A.set(5)
  → B receives DIRTY (marks dirty bit 0)
  → C receives DIRTY (marks dirty bit 0)
  → D receives DIRTY from B (marks dirty bit 0)
  → D receives DIRTY from C (marks dirty bit 1)
  D knows: 2 deps are dirty, wait for both
```

**Phase 2 — Value propagation (type 1):**
After DIRTY propagation completes, actual values flow. Each node waits until all its dirty deps have delivered before computing:

```
A emits 5
  → B computes: A.get() * 2 = 10, emits 10
  → C computes: A.get() + 1 = 6, emits 6
  → D has 1 dep resolved (B). Dirty bitmask: still waiting on C.
  → D receives C's value. Bitmask clear. Now computes: B.get() + C.get() = 16
  → D sees consistent state. No glitch.
```

D never computes with partial information. The bitmask (one bit per dependency) tracks exactly which deps have resolved. When the bitmask reaches zero, all deps are fresh. This works for any DAG topology — not just diamonds, but arbitrary fan-in patterns.

## RESOLVED: the signal that skips subtrees

Here's where protocol-level design really pays off.

Imagine A changes, but B's `equals` guard determines the output hasn't actually changed (e.g., B clamps values to a range, and A moved within the same range). In most reactive systems, B still notifies its children, who recompute and discover nothing changed.

With type 3, B sends `RESOLVED` instead of a new value:

```ts
// B's computation
const newValue = clamp(A.get(), 0, 100);
if (equals(oldValue, newValue)) {
  // Value didn't change — tell downstream to stand down
  emit(STATE, RESOLVED);
} else {
  emit(DATA, newValue);
}
```

Downstream nodes receiving RESOLVED decrement their dirty bitmask *without recomputing*. If all of D's deps sent RESOLVED, D itself emits RESOLVED without ever calling its function. The skip cascades through the entire subtree.

This is push-phase memoization. It's not an optimization bolted on after the fact — it's a natural consequence of having a control channel in the protocol. No other mainstream reactive system has this.

## Protocol composability vs API composability

Here's the philosophical difference that shapes everything:

**API composability** (Zustand, Jotai, Signals): You compose by calling functions that return objects with known shapes. `createStore()` returns a store. `computed()` returns a computed signal. The composition boundary is the function signature.

**Protocol composability** (callbag-recharge): You compose by connecting callbags. Any function that speaks the 4-type protocol can plug into any other. The composition boundary is the protocol — not the API surface.

This is why callbag-recharge can offer:
- **70+ stream operators** (map, filter, switchMap, debounce...) that work on state stores
- **Reactive data structures** (reactiveMap, reactiveLog, reactiveIndex) that participate in the graph
- **Workflow orchestration** (pipeline, task, gate, branch) built on the same primitives
- **Compatibility wrappers** (Zustand, Jotai, Signals, Nanostores) that bridge protocols

Every new primitive we add automatically works with every existing operator. Not because we designed it that way for each combination — but because they all speak the same protocol.

## The store interface: protocol hidden, power accessible

Callbag is the engine. Users never see it.

The public API is a `Store`:

```ts
interface Store<T> {
  get(): T;                    // Pull current value
  source(): Callbag;           // Access the underlying callbag (escape hatch)
}

interface WritableStore<T> extends Store<T> {
  set(value: T): void;         // Push new value
}
```

Three methods. That's the entire user-facing surface for state management. Everything else — the DIRTY/RESOLVED protocol, the bitmask tracking, the output slot optimization — is internal machinery that makes `get()` and `set()` behave correctly.

```ts
import { state, derived, effect } from 'callbag-recharge';

const count = state(0);
const doubled = derived([count], () => count.get() * 2);

effect([doubled], () => {
  console.log('doubled:', doubled.get());
});

count.set(5); // logs: "doubled: 10"
```

No observables to subscribe to. No `.value` accessors. No `useSignal()` hooks. Just `get()` and `set()`.

But when you need stream power, the callbag protocol is right there:

```ts
import { pipe, map, filter, throttle, subscribe } from 'callbag-recharge/extra';

// Same store, now treated as a stream
pipe(
  count,
  filter(n => n > 0),
  map(n => n * 2),
  throttle(100),
  subscribe(v => console.log(v))
);
```

Same `count` store. Same underlying callbag. The protocol doesn't care whether you're treating it as "state" or "stream" — it just pushes data through the graph.

## What the protocol gives us for free

Because callbag-recharge is protocol-first, several things fall out naturally:

**Inspector/DevTools**: Every node speaks the same protocol, so a single Inspector can observe any node in the graph — state, derived, operator, effect, data structure, orchestration task. One tool sees everything.

**Cross-boundary composition**: A `reactiveMap` (data structure) can be a dependency of a `derived` (state) which feeds into a `pipeline` (orchestration). No adapter layers needed.

**Forward compatibility**: Unknown type 3 signals are forwarded, not swallowed. We can add PAUSE, RESUME, CHECKPOINT signals in the future without modifying existing operators.

**Zero-framework coupling**: The protocol doesn't reference React, Vue, Solid, or any framework. Compat layers are thin wrappers that bridge `Store.source()` to framework-specific subscriptions.

---

The protocol is the product. Everything else is convenience.

---

*Next: [Signals Are Not Enough](./03-signals-are-not-enough) — where TC39 Signals excel, where they fall short, and why the reactive programming world needs more than fine-grained UI state.*
