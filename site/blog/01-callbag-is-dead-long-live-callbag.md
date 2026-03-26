---
title: "Callbag Is Dead. Long Live Callbag."
description: "Why we bet on a forgotten reactive protocol in the age of Signals — and what everyone else missed about callbag's design."
date: 2026-03-21
author: David Chen
outline: deep
---

# Callbag Is Dead. Long Live Callbag.

![Callbag Flow](/blog-heroes/hero-01.png)

*Arc 1, Post 1 — Origins: Why Revive Callbag?*

---

In 2018, André Staltz published [callbag](https://github.com/callbag/callbag), a spec for reactive programming based on a single function signature. No classes. No inheritance. No framework. Just functions calling functions.

```ts
(type: 0 | 1 | 2, payload?: any) => void
```

That's the entire spec. A callbag is a function that takes a type (0 for handshake, 1 for data, 2 for termination) and an optional payload. Sources and sinks are both callbags. They talk to each other through this one interface.

The community built operators, adapters, utilities. Then it went quiet. By 2022, most callbag repos hadn't seen a commit in years. RxJS was entrenched. The Signals wave was building. Callbag was, by all reasonable measures, dead.

We revived it anyway.

## What hooked me before there was a roadmap

I didn't start with a business case. I started with a design crush.

Callbag’s spec is tiny: one function type, a handful of numeric message kinds — and yet it describes a **full duplex** conversation. The sink and the source are the same kind of thing. When they connect, the source hands back **talkback**: another callbag the sink can invoke. That one mechanism covers push *and* pull without splitting the model. You can request the next value, cancel, or negotiate backpressure through the same callable interface the stream already uses for data.

That symmetry felt like the right abstraction for problems that mix “tell me when you have something” with “give me the next thing when I ask” — not two libraries duct-taped together, one protocol.

The other half of the attraction was mechanical. A callbag is **just a closure**. State lives in captured variables, not in a parallel hierarchy of objects you allocate to participate in the system. Fewer moving parts on the hot path; no subscription class tax just to move a value through a graph. The elegance of the spec and the performance story point the same direction: **less machinery**.

The ecosystem moved on; the idea didn't let go.

## What everyone else saw

When people looked at callbag, they saw a minimalist alternative to RxJS. Simpler, lighter, but with fewer operators and no community momentum. A nice experiment that lost to network effects.

Fair assessment. Wrong conclusion.

## What we saw

We saw something different: **a protocol, not a library**.

RxJS gives you `Observable`, `Subject`, `BehaviorSubject`, `ReplaySubject`, `Subscriber`, `Subscription`, `Scheduler`, `Operator` — a type hierarchy that solves real problems but also cements a particular worldview. Your code becomes RxJS code. Your mental model becomes the RxJS mental model.

Callbag gives you a function signature. That's it. What you build on top is up to you.

This distinction matters enormously when you're trying to unify state management and stream processing — which is exactly what we needed.

## The state management problem

Here's the landscape in 2025:

- **Zustand, Jotai, Redux** — great for UI state, no streaming
- **RxJS** — great for streams, awkward for simple state
- **Preact Signals, SolidJS** — great for fine-grained reactivity, limited composability
- **TC39 Signals** — standardizing the basics, but explicitly excludes async/streaming

Every library solves one slice. If your app needs both a reactive counter *and* a WebSocket stream *and* an LLM response that arrives token by token — you're stitching together two or three libraries with glue code between them.

We wanted one primitive that handles all three. Not a mega-framework. A single, composable building block.

## Why callbag was the right foundation

Callbag's function signature is deceptively powerful:

```ts
// A callbag source that emits 1, 2, 3
const source = (type, data) => {
  if (type === 0) { // START: handshake
    const sink = data;
    sink(0, (t, d) => { // send talkback
      if (t === 1) { /* pull request — ignore for push sources */ }
      if (t === 2) { /* sink unsubscribed */ }
    });
    sink(1, 1); // DATA: emit 1
    sink(1, 2); // DATA: emit 2
    sink(1, 3); // DATA: emit 3
    sink(2);    // END: complete
  }
};
```

Three properties make this special:

**1. Sources and sinks are the same type.** A callbag can be both. This means an operator is just a function that receives a source callbag and returns a new source callbag. No `pipe()` magic, no operator overloading — just function composition.

**2. The handshake is bidirectional.** When a sink connects to a source, the source sends back a "talkback" — a callbag the sink can use to communicate upstream. This enables pull semantics, cancellation, and backpressure without any additional API.

**3. There are no classes.** A callbag is a closure. It captures its state in lexical scope. No `this` binding issues, no prototype chains, no `instanceof` checks. This makes callbags trivially serializable, transferable across workers, and invisible to framework-specific tooling.

## The missing piece: type 3

Here's what made us commit to the bet.

The original callbag spec defines types 0, 1, and 2. But the signature is `(type: number, payload?)` — it's an open protocol. There's nothing stopping you from using type 3.

When we faced the diamond problem in reactive state graphs — the classic glitch where a derived value sees inconsistent intermediate states — we realized callbag already had the infrastructure for the solution. We just needed a control channel.

Type 3 became our STATE channel: `DIRTY` signals that propagate instantly through the graph, telling every downstream node "something is about to change, don't compute yet." Followed by actual values on type 1.

Two-phase push. Glitch-free diamond resolution. Built on an extension of the existing callbag protocol, not a bolt-on workaround.

No other reactive protocol gave us this for free. RxJS would need a parallel notification channel. Signals would need... well, Signals don't have channels at all.

## The bet

We're betting that the future of reactive programming isn't in choosing between state management and stream processing. It's in unifying them.

A `state(0)` that holds a counter and a `producer()` that wraps an LLM stream should compose with the same operators, flow through the same graph, and be observable with the same tools. The user shouldn't have to think about whether their data is "state" or "stream" — it's just a store with a `get()` and a `source()`.

Callbag's protocol is minimal enough to support this. And unlike a dead API, a dead protocol is easy to revive — you just write a better implementation.

That's what callbag-recharge is. Same protocol. New architecture. The state management layer that callbag was always meant to have.

---

*Next: [The Protocol That Already Solved Your Problem](./02-the-protocol-that-already-solved-your-problem) — a deep dive into callbag's 4-type system and why protocol-level design beats API sugar.*
