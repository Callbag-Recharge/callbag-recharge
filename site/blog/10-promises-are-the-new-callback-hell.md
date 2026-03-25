---
title: "Promises Are the New Callback Hell"
description: "How we eliminated every internal Promise from callbag-recharge and replaced them with pure callbag sources — the patterns, the pitfalls, and why it matters for composition."
date: 2026-03-24
author: David Chen
outline: deep
---

# Promises Are the New Callback Hell

*Arc 4, Post 10 — Callbag-Native: Promise Elimination*

---

Promises fixed callbacks. `async/await` fixed Promises. So why did we just rip out every `await` from a 170-module reactive library?

Because in a callbag-based system, Promises are the wrong abstraction. They break composition, they force you into sequential thinking, and they create invisible boundaries where reactive flow stops and imperative code takes over. We had 176 instances of Promise patterns across 53 files. Every one was a seam where the graph couldn't see what was happening.

This post documents the replacement patterns we used, the bugs we found along the way, and the architectural principle that drove it all: **callbag-in, callbag-out, everywhere.**

## The problem: two worlds

Consider a retry loop. The Promise version reads naturally:

```ts
async function runWithRetry(fn, retries, delay) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
```

Clean. Sequential. And completely opaque to the reactive graph.

When `task()` used this pattern internally, the graph saw: task started... (silence)... task finished. No intermediate status. No way to cancel the delay reactively. No way for a parent pipeline's RESET signal to propagate through. The `await` keyword created a black hole where TYPE 3 STATE signals couldn't reach.

The callbag version is continuation-based:

```ts
function runTask(attempt) {
  ts.run(fn);
  subscribe(ts.status, (s) => {
    if (s === "running" || s === "idle") return;
    if (s === "success") emit(ts.result.get());
    else if (attempt < retries) {
      ts.reset();
      rawSubscribe(fromTimer(delay), () => runTask(attempt + 1));
    } else handleError(ts.error.get());
  });
}
runTask(0);
```

More code? Yes. But the graph sees everything. The retry delay is a `fromTimer` — cancellable via AbortSignal. The status transitions flow through `subscribe` — visible to Inspector. A parent pipeline can reset the task at any point and the signal propagates through the TYPE 3 channel.

## The replacement cheatsheet

Here are the patterns we used across the entire codebase. Every Promise pattern has a callbag equivalent.

### Delays

```ts
// Before: raw Promise delay
await new Promise(r => setTimeout(r, ms));
doNext();

// After: fromTimer is a callbag source
rawSubscribe(fromTimer(ms), () => {
  doNext();
});
```

`fromTimer(ms, signal?)` emits once after `ms` milliseconds, then completes. Pass an `AbortSignal` to cancel. No `new Promise`, no `setTimeout` directly — the reactive graph can see and cancel the delay.

### System boundary calls

```ts
// Before: await at the boundary
const response = await fetch(url);
const data = await response.json();
processData(data);

// After: wrap once, subscribe once
rawSubscribe(rawFromPromise(fetch(url).then(r => r.json())), (data) => {
  processData(data);
});
```

`rawFromPromise` bridges any Promise into a callbag source: resolved value becomes DATA, rejection becomes END with error. Wrap at the boundary, stay in callbag-land internally.

### User callbacks (the universal pattern)

```ts
// Before: assume Promise
const result = await userCallback(args);

// After: accept anything
rawSubscribe(rawFromAny(userCallback(args)), (result) => {
  handleResult(result);
});
```

`rawFromAny` is the universal normalizer. It accepts sync values, Promises, AsyncIterables, Iterables, or callbag sources — and returns a callbag source. This means user callbacks can return whatever is natural for their use case: a plain value, a Promise, an async generator, or even a callbag source if they're building on the library.

### Streaming responses

```ts
// Before: for-await loop
for await (const chunk of factory(msgs, signal)) {
  accumulated += chunk;
  partialStore.set(accumulated);
}

// After: rawFromAsyncIter
rawSubscribe(rawFromAsyncIter(factory(msgs, signal)), (chunk) => {
  accumulated += chunk;
  partialStore.set(accumulated);
});
```

`rawFromAsyncIter` converts any `AsyncIterable` into a callbag source. Each yielded value becomes a DATA emission. The source completes when the iterator is done.

### Racing (timeouts)

```ts
// Before: Promise.race
const result = await Promise.race([
  doWork(),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), ms)
  ),
]);

// After: rawRace
rawSubscribe(
  rawRace(rawFromAny(doWork()), rawTimeoutError(ms, signal)),
  (result) => handleResult(result),
  { onEnd: (err) => { if (err) handleError(err); } },
);
```

`rawRace` subscribes to multiple callbag sources and forwards the first one to emit. Losers are unsubscribed. If a source errors before any winner, the error propagates.

### Waiting for a reactive condition

```ts
// Before: await firstValueFrom (internal usage)
await firstValueFrom(child.status, (s) => s === "success" || s === "error");
doNext(child.status.get());

// After: subscribe with a guard
const unsub = subscribe(child.status, (s) => {
  if (s === "running" || s === "idle") return;
  unsub();
  doNext(s);
});
```

This was the most pervasive pattern in `orchestrate/`. Every `loop`, `subPipeline`, `forEach`, and `task` was `await`-ing on child status. The reactive version subscribes and continues in the callback when the condition is met. No Promise, no async function, no hidden scheduling.

### Adapter interfaces (sync or callbag)

```ts
// Before: sync or Promise union
interface Adapter {
  save(id: string, value: unknown): void | Promise<void>;
  load(id: string): unknown | undefined | Promise<unknown | undefined>;
}

// Detection
if (result instanceof Promise) { result.then(...) }

// After: sync or CallbagSource union
interface Adapter {
  save(id: string, value: unknown): void | CallbagSource;
  load(id: string): unknown | undefined | CallbagSource;
}

// Detection
if (typeof result === "function") { rawSubscribe(result, ...) }
```

Callbag sources are functions. Detection is `typeof === "function"` instead of `instanceof Promise`. Sync adapters return `void` or plain values — no change. Async adapters return a callbag source via `rawFromPromise(...)`.

## Where `firstValueFrom` survives

After the refactor, `firstValueFrom` exists in exactly three contexts:

1. **`raw/firstValueFrom.ts`** — the implementation itself (the ONE acceptable `new Promise` in the codebase)
2. **Tests** — test harness code uses it for convenience when bridging to `await`
3. **Exported for end users** — the escape hatch from callbag-land to Promise-land

It is never used internally in production source code. Think of it like `node:fs/promises` — a convenience layer over the native API, not the primary interface.

## What we found along the way

The refactor exposed real bugs:

**Synchronous emission and temporal dead zones.** When we removed `Promise.resolve().then()` deferrals from `rateLimiter.acquire()` (which violated our own §1.18 — no microtask scheduling for reactive coordination), the immediate-token-available path started emitting synchronously. This exposed a TDZ bug in `firstValueFrom`: it used `const sub = rawSubscribe(source, (v) => { sub.unsubscribe(); ... })` — but if the source emits synchronously within `rawSubscribe`, `sub` is referenced before assignment. Fixed with `let sub` and optional chaining.

**Resource leaks on cancellation.** `asyncQueue.enqueue()` now returns a callbag source. When the downstream cancels, the task still runs (queue semantics), but the subscription and internal state store need cleanup regardless. The early `return` on `cancelled` was skipping `teardown(done$)` — leaking one state store per cancelled task.

**Clean END without DATA.** Both `checkpoint` and `cascadingCache` had the same bug: the `onEnd` handler only handled errors (`err !== undefined`). A callbag source that signals "miss" by completing without emitting any DATA — rather than emitting `undefined` — left the load permanently pending. The built-in adapters (all using `rawFromPromise`) always emit the resolved value as DATA, so tests passed. But custom adapters could trigger the bug.

## The principle

Architecture §1.20 now reads:

> **Callbag-native output — no internal Promise APIs.** Every internal API returns callbag sources, not Promises. System boundary calls are wrapped into callbag sources immediately via `raw/fromPromise` or `raw/fromAsyncIter`. User-provided async callbacks are wrapped with `raw/fromAny`. `firstValueFrom` remains the ONE bridge from callbag to Promise but is never used internally.

The pattern is simple: **wrap at the boundary, stay native inside.** Promises are for the edges of the system — user-facing convenience, test harnesses, and the `firstValueFrom` bridge. Everything inside the graph speaks callbag.

This is not about Promises being bad. It is about composition. A callbag source can be raced, mapped, filtered, cancelled, inspected, and composed with other sources. A Promise is a one-shot value with no backpressure, no cancellation (without `AbortSignal` gymnastics), and no visibility to the reactive graph.

In a library where control flows through the graph (§1.15), having half the internal code exit the graph into Promise-land was the real callback hell.
