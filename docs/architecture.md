# Architecture

## Overview

callbag-recharge is built on four layers. Each layer has a single responsibility, and upper layers never reach past the one below them.

```
┌──────────────────────────────────────────────┐
│  User API                                    │
│  state · derived · stream · effect · pipe    │
│  batch · pipeRaw · SKIP                      │
├──────────────────────────────────────────────┤
│  Store layer — plain objects { get, set? }   │
│  No wrapper classes, no defineProperties     │
├──────────────────────────────────────────────┤
│  Callbag protocol (internal)                 │
│  DIRTY symbol via type 1 push                │
│  Value pull via .get() chain                 │
├──────────────────────────────────────────────┤
│  Inspector (global singleton, disableable)    │
│  WeakMaps for metadata — zero per-store cost │
│  enabled · inspect · trace · graph           │
└──────────────────────────────────────────────┘
```

---

## Design principles

### 1. Stores are plain objects

A store is `{ get, set?, source }` — nothing more. No classes, no `Object.defineProperties`, no function-as-object tricks. This keeps memory low (~723 bytes per state store with Inspector enabled, less with it disabled) and avoids fighting JavaScript's runtime (e.g., `Function.name` being read-only).

Debug metadata (name, kind) lives in the global `Inspector` singleton backed by WeakMaps, not on the store itself. Stores that aren't named don't pay for naming.

### 2. Push invalidation, pull computation

This is the core architecture decision that solves the diamond problem.

**Push phase:** When a state changes, it pushes a `DIRTY` symbol through callbag sinks. This is cheap — just setting a symbol reference, no values computed. DIRTY propagates through the entire downstream graph instantly.

**Pull phase:** Values are only computed when someone calls `.get()`. The `.get()` call walks up the dependency graph, ensuring each node computes with fresh inputs. This naturally produces a topological ordering — no scheduling algorithm needed.

```
A.set(5)
  Push: A → DIRTY → B → DIRTY → D
        A → DIRTY → C → DIRTY → D (already dirty, skip)

D.get()
  Pull: D calls fn()
          → B.get() → B calls fn() → A.get() → returns 5 → B = 6
          → C.get() → C calls fn() → A.get() → returns 5 → C = 10
        D = 16 (computed once, consistent state)
```

### 3. Explicit deps, callbag wiring

`derived` and `effect` take an explicit deps array that declares which stores to subscribe to via callbag protocol. The `fn` still calls `.get()` to pull values — deps declare *what to subscribe to*, `.get()` declares *what to read*.

```ts
const sum = derived([a, b], () => a.get() + b.get())
```

This is a deliberate departure from the implicit tracking pattern (Signals/MobX) where deps are discovered by intercepting `.get()` calls at runtime. Explicit deps have several advantages:

- **Pure pull:** `.get()` is just a function call with no side effects — no tracking context, no Set allocation, no dependency diffing. This makes reads ~10x faster.
- **Static deps:** Effect deps are wired once on creation and never reconnect, eliminating per-run overhead.
- **Predictable:** All deps are visible in the call site. No surprises from conditional reads changing the dependency graph.
- **Simpler internals:** No global mutable state for tracking, no `registerRead()` in every store's `.get()`.

### 4. No cache in derived stores (by default)

Derived stores always run their computation function on `.get()`. There is no cached value, no dirty flag, no staleness tracking by default.

**Why:** Caching requires dirty flags, version counters, and careful invalidation logic — all sources of bugs. Without caching, the model is simpler: state and stream stores hold values because they are **sources of truth**; derived stores are pure functions that pull from their dependencies.

**Tradeoff:** Repeated reads of the same derived store re-run the computation. For the vast majority of use cases, the computation is a simple expression (e.g., `a.get() + b.get()`) that takes nanoseconds.

**Opt-in caching via `equals`:** Providing an `equals` option enables pull-phase caching — the derived store remembers its last output and returns the cached value if `equals(cached, recomputed)` returns true. This is useful for derived stores whose output stabilizes (e.g., clamping, rounding, enum mapping). See [optimizations](./optimizations.md).

### 5. `undefined` means empty

No special `EMPTY` symbol, no `.ready` flag. If a stream hasn't emitted or a filter hasn't passed anything, `.get()` returns `undefined`. This is JavaScript's natural "no value" — the library doesn't invent another one.

Type implications:
- `state<T>(initial)` → `.get()` returns `T` (always has a value)
- `stream<T>(producer)` → `.get()` returns `T | undefined` (might not have emitted)
- `derived<T>(deps, fn)` → `.get()` returns whatever `fn` returns (TypeScript infers it)

### 6. Observability is external and disableable

The `Inspector` singleton stores names and kinds in WeakMaps, and tracks all living stores via `WeakRef`. This means:

- Stores carry zero observability overhead on the hot path
- Garbage-collected stores are automatically cleaned up
- Unnamed stores don't pay for naming
- The entire reactive graph is queryable at any time via `Inspector.graph()`

Setting `Inspector.enabled = false` makes `register()` and `getName()` no-ops, eliminating all WeakRef/WeakMap overhead in production. The flag defaults to enabled when `NODE_ENV !== 'production'`.

---

## How each primitive works

### `state`

The simplest store. Holds a value, exposes a callbag source.

```
state(0, { equals? })
  ├── currentValue: 0
  ├── sinks: Set<callbag sink>
  ├── eq: opts.equals ?? Object.is
  ├── get() → return currentValue
  ├── set(v) → if eq(current, v), skip; else update + pushDirty(sinks)
  └── source(type, payload) → callbag handshake, stores sink, sends talkback
```

The callbag talkback supports:
- Type 1 (pull): responds with `currentValue`
- Type 2 (end): removes the sink from the set

### `derived`

A computed store with explicit deps and lazy upstream connection.

```
derived([a, b], () => a.get() + b.get(), { equals? })
  ├── deps: Store[] (fixed, declared upfront)
  ├── sinks: Set<callbag sink>
  ├── upstreamTalkbacks: talkback functions for disconnecting
  ├── cachedValue / hasCached (only active when equals provided)
  ├── get() → run fn(), if equals && cached matches → return cached, else return result
  └── source(type, payload) → callbag handshake, connects to deps on first sink,
                               disconnects when last sink leaves, propagates DIRTY
```

**Explicit deps:** The deps array declares which stores to subscribe to. The `fn` calls `.get()` on those stores to pull values. All deps are listed upfront — no runtime discovery.

**Lazy connection:** The derived store doesn't connect to upstream deps until the first sink subscribes (via `source()`). When the last sink disconnects, it disconnects from all deps. If nobody subscribes, it never receives DIRTY — but `get()` still works as a pure pull.

**DIRTY propagation:** When an upstream dep pushes DIRTY, the derived store propagates DIRTY to its own sinks (for effects/subscribers downstream). It does NOT recompute — that waits for the next `.get()`.

### `stream`

A store backed by an event source. Supports push-based, pull-based, or hybrid producers.

```
stream((emit, request) => { ... })
  ├── currentValue: T | undefined
  ├── sinks: Set<callbag sink>
  ├── pullHandler: (() => void) | null
  ├── get() → return currentValue
  ├── pull() → invoke pullHandler or throw
  └── source(type, payload) → callbag handshake, starts producer lazily
```

**Push-based:** The producer calls `emit(value)` whenever it has data. The stream updates `currentValue` and pushes DIRTY to sinks.

**Pull-based:** The producer calls `request(handler)` to register a pull handler. The user calls `.pull()` to invoke it, which typically calls `emit()` inside.

**Lazy start:** The producer doesn't run until the first callbag sink connects (via `.source(0, sink)`).

**Auto-cleanup:** When all sinks disconnect (via talkback type 2), the producer's cleanup function runs.

### `effect`

Runs a function and re-runs it when dependencies change. Deps are static — wired once on creation.

```
effect([count, doubled], () => { console.log(count.get(), doubled.get()) })
  ├── deps: Store[] (fixed, declared upfront)
  ├── talkbacks: Array<talkback> for disconnecting from deps
  ├── pending: boolean (dedup flag)
  ├── run() → cleanup previous, call fn(), store new cleanup
  └── dispose() → cleanup + disconnect all
```

**Static connection:** Unlike the previous auto-tracking design, effects connect to their deps once on creation and never reconnect. This eliminates per-run tracking context setup and callbag reconnection overhead.

**Batching:** When DIRTY arrives, the effect doesn't re-run immediately. It enqueues itself via `enqueueEffect()`. The protocol layer flushes all pending effects only after DIRTY propagation completes (propagation depth reaches 0). This ensures diamond patterns trigger the effect once, not once per path.

### `subscribe`

Like effect, but for a single store. Connects as a callbag sink, deferred via `enqueueEffect()`.

---

## The protocol layer

### `DIRTY` symbol

A unique `Symbol('DIRTY')` pushed via callbag type 1. Downstream stores and sinks distinguish it from actual data values. This is a minor extension of the callbag spec — type 1 normally carries data, but we use it for invalidation signals too.

Precedent: other callbag utilities like [callbag-pausable](https://github.com/erikras/callbag-pausable) similarly use type 1 for control signals.

### Propagation batching

```ts
let depth = 0;
const pending: Array<() => void> = [];

function pushDirty(sinks) {
  depth++;
  for (const sink of sinks) sink(1, DIRTY);
  depth--;
  if (depth === 0) flush();
}
```

`depth` tracks re-entrant DIRTY propagation. Effects are only flushed when the outermost `pushDirty` completes. This prevents effects from running mid-propagation, which would cause diamond glitches.

The `batch()` function leverages this same mechanism — it increments `depth` before running the callback and decrements after, so effects flush only when the outermost batch completes:

```ts
function batch<T>(fn: () => T): T {
  depth++;
  try { return fn(); }
  finally { depth--; if (depth === 0) flush(); }
}
```

---

## Callbag interop

Every store exposes a `.source` property — a standard callbag source function. The `DIRTY` symbol is exported for consumers that need to distinguish invalidation signals from actual data.

```ts
import { DIRTY } from 'callbag-recharge'

store.source(0, (type, data) => {
  if (type === 0) { /* talkback received */ }
  if (type === 1 && data === DIRTY) { /* invalidation */ }
  if (type === 1 && data !== DIRTY) { /* actual value from pull */ }
  if (type === 2) { /* stream ended */ }
})
```

Talkback supports:
- Type 1: pull — source responds with current value via `sink(1, value)`
- Type 2: disconnect — source removes the sink

---

## File structure

```
src/
  types.ts       — Store, WritableStore, StreamStore interfaces
  protocol.ts    — DIRTY symbol, pushDirty(), enqueueEffect(), batch(), batching
  inspector.ts   — Global singleton with WeakMaps, enabled flag
  state.ts       — state() factory (custom equals support)
  derived.ts     — derived(deps, fn) factory (explicit deps, lazy connection, optional equals caching)
  stream.ts      — stream() factory (push + pull, custom equals)
  effect.ts      — effect(deps, fn) factory (static deps, batched re-runs)
  subscribe.ts   — subscribe() function
  pipe.ts        — pipe() + map, filter, scan operators + pipeRaw(), SKIP
  index.ts       — Public exports
```

Minified ESM bundle: ~1.5 KB (core entry point). CJS: ~4.4 KB.
