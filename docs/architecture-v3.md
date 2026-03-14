# Architecture v3 — Type 3 Control Channel

This document describes the target architecture for callbag-recharge's next major refactor. The core idea: separate **state management signals** (DIRTY, RESOLVED) from **data transport** (values) by using callbag type 3 as a dedicated control channel, keeping type 1 DATA as pure values.

---

## Motivation

### Current design (v2): two-phase push on a single DATA channel

The v2 architecture sends both DIRTY sentinels and actual values on type 1 DATA:

```ts
sink(1, DIRTY)   // invalidation signal
sink(1, value)   // actual data
```

This forces **every node** in the graph to bifurcate its DATA handler:

```ts
if (data === DIRTY) { /* phase 1 logic */ }
else { /* phase 2 logic */ }
```

Consequences:
- Every operator (take, skip, map, filter) must understand DIRTY to participate in diamond resolution
- `subscribe` needs a `pending` flag to distinguish DIRTY from values
- Extra operators require full rewrites to be "two-phase aware"
- The library is incompatible with raw callbag operators since DATA carries non-value signals
- Global `enqueueEffect`, `pendingValueEmitters`, and `propagating` flags manage complex phase transitions

### Target design (v3): separate control channel

All data flows as plain values on type 1. State management signals flow on type 3:

```
sink(0, talkback)      // START — callbag handshake
sink(1, value)         // DATA  — always a real value, never a sentinel
sink(2, error?)        // END   — completion or error
sink(3, signal)        // STATE — control signals (DIRTY, RESOLVED, future PAUSE/RESUME)
```

One graph. One set of callbag connections. Type 3 is just a different message type on the same wire. No separate state graph, no parallel notification system.

### Benefits

- **Type 1 DATA is pure callbag again.** Values only. Compatible with external callbag operators.
- **Operators don't need DIRTY awareness.** `take`, `skip`, `map`, `filter` handle type 1 values like any callbag operator. Type 3 signals pass through via a simple forwarding convention.
- **State management is opt-in.** Only nodes that need diamond resolution listen to type 3.
- **RESOLVED enables true subtree skipping.** `equals` memoization can skip entire downstream computation, not just suppress values.
- **Minimal global state.** Only `batch` needs global coordination. No `enqueueEffect`, no `propagating` flag, no phase 2 queue.
- **Extensible.** Future signals (PAUSE, RESUME) are new constants on type 3 — no API changes needed.

---

## Control channel signals

Type 3 carries state management signals. The initial vocabulary:

| Signal | Meaning | Sent by |
|--------|---------|---------|
| `DIRTY` | "My value is about to change" | Sources (producer, state) and operators when a dep goes dirty |
| `RESOLVED` | "I was dirty but my value didn't change" | Operators when equals suppresses, filter rejects, or all deps resolved without change |

Future extensions (not in initial implementation):

| Signal | Meaning |
|--------|---------|
| `PAUSE` | Backpressure — "stop sending values" |
| `RESUME` | "OK, send again" |

Signals are opt-in. Nodes that don't understand a signal forward it (convention) or ignore it. DATA stays clean.

---

## Primitives

### Taxonomy

```
              General          Specialized
              -------          -----------
Source        Producer    ->   State (equality-checked set)
Transform     Operator    ->   Derived (multi-dep dirty tracking + cache)
Sink          Effect
```

Five primitives total, three callbag roles with two specializations.

### Tier model

| Tier | What | Glitch-free | Built with |
|------|------|-------------|------------|
| **Tier 1** | State graph + passthrough operators | Yes — type 3 DIRTY flows through | Producer, State, Operator, Derived, Effect |
| **Tier 2** | Async/timer/dynamic-subscription operators | No — cycle boundary | Producer wrapping subscribe+emit |

Tier 1 nodes participate in diamond resolution via type 3 signals. Tier 2 nodes are cycle boundaries where each `emit` starts a new DIRTY+value cycle. This matches RxJS behavior — time-based and dynamic-subscription operators are natural glitch boundaries in any reactive system.

---

## Producer

The general-purpose source primitive. Can emit values, send control signals, and complete.

```ts
const counter = producer<number>((actions) => {
  let i = 0;
  const id = setInterval(() => actions.emit(i++), 1000);
  return () => clearInterval(id);
});

counter.get();    // last emitted value
counter.source;   // callbag source
```

### Actions API

The producer function receives an `actions` object:

```ts
type Actions<T> = {
  emit: (value: T) => void,       // type 1 DATA to downstream sinks
  signal: (s: Signal) => void,    // type 3 STATE to downstream sinks
  complete: () => void,            // type 2 END to downstream sinks
}
```

### Auto-DIRTY

By default, `emit(value)` automatically sends `signal(DIRTY)` before the value. This is the common case for sources — every value emission is a state change.

```ts
// Default: emit = signal(DIRTY) + type 1 value
const clicks = producer<MouseEvent>((actions) => {
  const handler = (e: MouseEvent) => actions.emit(e);  // auto DIRTY + value
  document.addEventListener('click', handler);
  return () => document.removeEventListener('click', handler);
});

// Opt out for manual control (complex operators like switchMap)
const custom = producer<number>(({ emit, signal }) => {
  signal(DIRTY);
  // ... async work ...
  emit(value);   // raw type 1, no auto DIRTY
}, { autoDirty: false });
```

### Internals

```
producer<T>(fn, opts?)
  +-- currentValue: T | undefined
  +-- sinks: Set<callbag sink>
  +-- get() -> return currentValue
  +-- source(type, payload) -> callbag handshake, manages sinks
  +-- Lazy start: producer function runs on first sink connection
  +-- Auto-cleanup: producer cleanup runs when last sink disconnects
```

The producer function receives actions and returns an optional cleanup function. The producer starts lazily (on first sink) and cleans up when all sinks disconnect.

---

## State

Specialized Producer for Signals-compatible writable stores. Sugar over Producer with equality-checked `set()`.

```ts
const count = state(0);
count.get();     // 0
count.set(5);    // equality check -> signal(DIRTY) -> emit(5)
count.update(n => n + 1);
```

### Relationship to Producer

State is conceptually:

```ts
function state<T>(initial: T, opts?: StoreOptions<T>): WritableStore<T> {
  const eq = opts?.equals ?? Object.is;
  const p = producer<T>(/* no producer fn needed */, { initial });

  return {
    get: p.get,
    set(value: T) {
      if (!eq(p.get(), value)) p.emit(value);  // equality guard
    },
    update(fn) { this.set(fn(p.get())); },
    source: p.source,
  };
}
```

State adds: equality-checked `set()`, `update()`. That's it. The architecture has one source primitive (Producer), and State is API sugar.

---

## Operator

The general-purpose transform primitive. Receives all signal types from upstream deps and decides what to forward downstream. This is the building block for tier 1 operators.

```ts
function operator<B>(
  deps: Store<unknown>[],
  init: (actions: Actions<B>) => (depIndex: number, type: number, data: any) => void,
  opts?: { initial?: B }
): Store<B>
```

The `init` function receives actions and returns a handler. The handler is called for every event from every dep, with `depIndex` indicating which dep sent it.

### Actions API

Same shape as Producer:

```ts
type Actions<T> = {
  emit: (value: T) => void,        // type 1 DATA downstream
  signal: (s: Signal) => void,     // type 3 STATE downstream (DIRTY, RESOLVED, etc.)
  complete: () => void,             // type 2 END downstream
  disconnect: (dep?: number) => void,  // disconnect from upstream dep(s)
}
```

### Transparent forwarding convention

Callbag operators that don't understand type 3 should forward it:

```ts
// Any callbag operator
if (type === 0) { /* start */ }
else if (type === 1) { /* data — transform and emit */ }
else if (type === 2) { /* end */ }
else { sink(type, data); }  // forward unknown types (including type 3)
```

This makes existing callbag operators type 3 compatible without modification. DIRTY signals pass through operator chains automatically.

### Examples

**map** — transform values, forward all signals:

```ts
function map<A, B>(fn: (a: A) => B): StoreOperator<A, B> {
  return (input) => operator<B>([input], ({ emit, signal }) => {
    return (dep, type, data) => {
      if (type === 3) signal(data);         // forward DIRTY, RESOLVED, etc.
      if (type === 1) emit(fn(data));       // transform value
    };
  });
}
```

**filter** — conditionally forward, use RESOLVED when suppressing:

```ts
function filter<A>(pred: (a: A) => boolean): StoreOperator<A, A> {
  return (input) => operator<A>([input], ({ emit, signal }) => {
    return (dep, type, data) => {
      if (type === 3) signal(data);         // forward signals
      if (type === 1) {
        if (pred(data)) emit(data);         // passed — emit value
        else signal(RESOLVED);              // suppressed — resolve without value
      }
    };
  });
}
```

**take** — forward n values then disconnect:

```ts
function take<A>(n: number): StoreOperator<A, A> {
  return (input) => operator<A>([input], ({ emit, signal, disconnect, complete }) => {
    let count = 0;
    return (dep, type, data) => {
      if (type === 3) {
        if (count < n) signal(data);        // forward while active
      }
      if (type === 1) {
        if (count < n) {
          count++;
          emit(data);
          if (count >= n) { disconnect(); complete(); }
        }
      }
      if (type === 2) complete();
    };
  });
}
```

**skip** — suppress first n values:

```ts
function skip<A>(n: number): StoreOperator<A, A> {
  return (input) => operator<A>([input], ({ emit, signal }) => {
    let count = 0;
    return (dep, type, data) => {
      if (type === 3) {
        if (count >= n) signal(data);
        // else: will suppress, but don't send RESOLVED yet (wait for value to count)
      }
      if (type === 1) {
        count++;
        if (count > n) emit(data);
        else signal(RESOLVED);              // skipped — resolve without value
      }
      if (type === 2) signal(data);
    };
  });
}
```

**scan** — accumulate values:

```ts
function scan<A, B>(fn: (acc: B, val: A) => B, seed: B): StoreOperator<A, B> {
  return (input) => operator<B>([input], ({ emit, signal }) => {
    let acc = seed;
    return (dep, type, data) => {
      if (type === 3) signal(data);
      if (type === 1) { acc = fn(acc, data); emit(acc); }
    };
  }, { initial: seed });
}
```

### Internals

```
operator<B>(deps, init, opts?)
  +-- currentValue: B | undefined (cache for get())
  +-- sinks: Set<callbag sink>
  +-- upstreamTalkbacks: talkback[] for disconnecting
  +-- get() -> return currentValue
  +-- source(type, payload) -> callbag handshake, connects upstream lazily
  +-- Lazy connection: connects to deps on first sink, disconnects on last
```

Operator manages upstream connections, downstream sinks, and the store interface. The handler function provides the custom transform logic.

---

## Derived

Specialized Operator for computed stores with multi-dep dirty tracking, caching, and diamond resolution. Sugar over Operator with a specific handler pattern.

```ts
const sum = derived([a, b], () => a.get() + b.get());
```

### Relationship to Operator

Derived is implementable on top of Operator:

```ts
function derived<T>(deps: Store<unknown>[], fn: () => T, opts?: StoreOptions<T>): Store<T> {
  const eqFn = opts?.equals;

  return operator<T>(deps, ({ emit, signal }) => {
    const dirtyDeps = new Set<number>();
    let cachedValue: T;
    let hasCached = false;

    return (depIndex, type, data) => {
      if (type === 3 && data === DIRTY) {
        const wasEmpty = dirtyDeps.size === 0;
        dirtyDeps.add(depIndex);
        if (wasEmpty) signal(DIRTY);           // forward DIRTY on first dirty dep
      }
      if (type === 3 && data === RESOLVED) {
        if (dirtyDeps.has(depIndex)) {
          dirtyDeps.delete(depIndex);
          if (dirtyDeps.size === 0) {
            signal(RESOLVED);                  // all deps resolved without value change
          }
        }
      }
      if (type === 1) {
        if (dirtyDeps.has(depIndex)) {
          dirtyDeps.delete(depIndex);
          if (dirtyDeps.size === 0) {
            // All dirty deps resolved — recompute
            const result = fn();
            if (eqFn && hasCached && eqFn(cachedValue, result)) {
              signal(RESOLVED);                // value unchanged — push-phase memoization
            } else {
              cachedValue = result;
              hasCached = true;
              emit(result);
            }
          }
        }
      }
    };
  }, opts);
}
```

### Diamond resolution

```
state A -> derived B -> derived D -> effect
            \-> derived C -/
```

**Phase 1 (type 3 DIRTY):**
1. A sends `sink(3, DIRTY)` to B, C
2. B: `dirtyDeps = {A}` -> forwards `sink(3, DIRTY)` to D
3. C: `dirtyDeps = {A}` -> forwards `sink(3, DIRTY)` to D
4. D: `dirtyDeps = {B, C}` (counts 2)

**Phase 2 (type 1 DATA):**
5. A sends `sink(1, value)` to B, C
6. B receives value, `dirtyDeps = {}`, recomputes, emits to D. D: resolves B, `dirtyDeps = {C}` — waits.
7. C receives value, `dirtyDeps = {}`, recomputes, emits to D. D: resolves C, `dirtyDeps = {}` — recomputes, emits.

D computes exactly once with both B and C fully resolved. No glitch.

### `equals` and RESOLVED — subtree skipping

When derived recomputes and `equals(cached, new)` returns true:

- Derived sends `signal(RESOLVED)` instead of `emit(value)`
- Downstream nodes that were counting this dep as dirty decrement their pending count without receiving a new value
- If ALL of a downstream node's dirty deps sent RESOLVED, that node sends RESOLVED too — **skipping `fn()` entirely**

This is more powerful than v2's approach where derived had to emit the unchanged value for bookkeeping. With RESOLVED, entire subtrees can be skipped when values don't change.

### `get()` semantics

- **Connected + settled** (dirtyDeps empty): return cached value (fast path)
- **Connected + pending** (dirtyDeps non-empty): recompute on demand by calling `fn()` which recursively pulls via deps' `get()`. Result is NOT cached — the callbag flow handles proper cache update.
- **Not connected** (no sinks): recompute on demand (one-shot pull, no callbag involved)

This preserves the guarantee that `get()` always returns a consistent value.

---

## Effect

Sink primitive with state participation. Tracks dirty deps across multiple inputs, runs `fn()` when all deps resolve.

```ts
const dispose = effect([count, doubled], () => {
  console.log(count.get(), doubled.get());
});
```

### How it works

Effect subscribes to deps on both type 3 and type 1:

- `sink(3, DIRTY)` from dep -> add dep to `dirtyDeps`
- `sink(3, RESOLVED)` from dep -> resolve dep without value change
- `sink(1, value)` from dep -> resolve dep
- When `dirtyDeps` is empty (all deps resolved) -> run `fn()` **inline**

Effect runs inline when its deps resolve — no global `enqueueEffect` needed. The callbag signal flow determines when the effect runs.

### Re-entrance

If an effect calls `state.set()` during execution, a new DIRTY signal propagates through the graph. This is handled naturally:

```
1. A.set(1) -> DIRTY to D -> DIRTY to E
2. A value -> D recomputes -> D value -> E runs fn()
3. E calls B.set(2) -> DIRTY to D -> DIRTY to E
4. B value -> D recomputes -> D value -> E runs fn()
```

Each cycle is clean because `dirtyDeps` tracks deps by identity (Set), not by cycle. When dep X resolves, X is removed from the set regardless of which cycle caused it. Multiple dirties from the same dep are idempotent (already in set).

Self-triggering effects (effect changes its own deps) will recurse — same as RxJS. The user is responsible for guarding against infinite loops, typically via equality checks in `set()`.

### Static connection

Unlike derived, effect connects eagerly on creation (it IS the terminal sink). Dependencies are static — wired once, never reconnect.

---

## Subscribe

A convenience sink (lives in extras, not core). Stateless — just reflects values it receives.

```ts
const unsub = subscribe(store, (value, prev) => { ... });
```

With type 3 separation, subscribe is trivially simple:

```ts
function subscribe<T>(store: Store<T>, cb: (value: T, prev: T | undefined) => void): () => void {
  let prev: T | undefined;

  store.source(START, (type, data) => {
    if (type === START) { talkback = data; }
    if (type === DATA) {
      const next = data as T;
      const p = prev;
      prev = next;
      cb(next, p);
    }
    if (type === END) { talkback = null; }
  });

  return () => talkback?.(END);
}
```

No DIRTY tracking, no pending flag, no `enqueueEffect`. Just a callbag sink that runs a callback on every value.

---

## Protocol

### Callbag signal types

```ts
const START = 0;   // callbag handshake
const DATA  = 1;   // values (always real values, never sentinels)
const END   = 2;   // completion or error
const STATE = 3;   // control signals (DIRTY, RESOLVED, PAUSE, RESUME, ...)
```

### Signal constants

```ts
const DIRTY    = Symbol("DIRTY");     // "my value is about to change"
const RESOLVED = Symbol("RESOLVED");  // "I was dirty but my value didn't change"
```

### Global state — batch only

The only global coordination is `batch`. No `enqueueEffect`, no `propagating` flag, no phase 2 value queue.

```ts
let batchDepth = 0;
const deferredEmissions: Array<() => void> = [];

function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      // Drain deferred type 1 emissions
      for (let i = 0; i < deferredEmissions.length; i++) {
        deferredEmissions[i]();
      }
      deferredEmissions.length = 0;
    }
  }
}
```

### How a state change propagates

**Without batch:**

```ts
state.set(5);
// 1. Equality check — if unchanged, return
// 2. Update currentValue
// 3. sink(3, DIRTY) to all sinks — synchronous, returns when all downstream notified
// 4. sink(1, value) to all sinks — values flow through the graph
// 5. Effects run inline when their deps resolve
```

No queue. DIRTY propagates on type 3, values emit on type 1. The channels don't interfere.

**With batch:**

```ts
batch(() => {
  a.set(1);   // sink(3, DIRTY) propagates immediately, value emission deferred
  b.set(2);   // sink(3, DIRTY) propagates immediately, value emission deferred
});
// batch ends: all deferred values emit on type 1
// derived nodes resolve, effects run inline
```

During batch: `set()` sends type 3 DIRTY immediately but defers type 1 value emission. After batch ends: all values emit, derived nodes resolve their dirty sets, effects run.

### Batch example with complex graph

```
a1 -> b1 -> c1 -> d1 -> e1
      b2 -> c2 -/    \
            c3 -------> e2
```

d1 depends on c1, c2. e2 depends on d1, c3.

```ts
batch(() => { a1.set(x); b2.set(y); c3.set(z); });
```

**DIRTY propagation (during batch, synchronous):**

```
a1.set(x): a1->b1  b1->c1  c1->d1  d1->e1, d1->e2
b2.set(y): b2->c2  c2->d1 (already dirty, no re-forward)
c3.set(z): c3->e2 (already dirty, no re-forward)
```

Dirty state after all DIRTY propagates:

| Node | dirtyDeps |
|------|-----------|
| b1 | {a1} |
| c1 | {b1} |
| c2 | {b2} |
| d1 | {c1, c2} |
| e1 | {d1} |
| e2 | {d1, c3} |

**Value propagation (after batch, deferred emissions drain):**

```
a1 value -> b1 resolves, recomputes, emits
  -> c1 resolves, recomputes, emits
    -> d1 resolves c1 -> dirtyDeps = {c2} -> WAITS

b2 value -> c2 resolves, recomputes, emits
  -> d1 resolves c2 -> dirtyDeps = {} -> recomputes, emits
    -> e1 resolves, RUNS
    -> e2 resolves d1 -> dirtyDeps = {c3} -> WAITS

c3 value -> e2 resolves c3 -> dirtyDeps = {} -> RUNS
```

Every node computes exactly once. Emission order doesn't matter — dep-identity tracking naturally resolves regardless of order.

---

## Dirty tracking by dep identity

Each stateful node tracks dirty deps in a `Set<depIndex>` rather than a counter or version number. This handles all cases without global coordination:

### Why not version numbers?

Versioned signals like `(DIRTY, v0)` were considered. The problem: when a value arrives on type 1, which version does it correspond to? Type 1 doesn't carry version info. Correlating versions across type 3 and type 1 would pollute the data channel.

Dep-identity tracking is simpler and more robust:

- DIRTY from dep X -> add X to dirty set
- Value from dep X -> remove X from dirty set
- Multiple dirties from same dep are idempotent (already in set)
- When dirty set is empty -> all deps resolved, safe to recompute

### Re-entrance safety

```
A.set(1):
  DIRTY to D -> D.dirtyDeps = {A}
  value to D -> D resolves A -> recomputes -> emits to E
  E runs -> B.set(2):
    DIRTY to D -> D.dirtyDeps = {B}
    value to D -> D resolves B -> recomputes -> emits to E
    E runs (no further changes)
```

Two clean cycles. The set tracks WHICH dep, not which cycle. No version disambiguation needed.

### Versions as debug metadata (optional)

Versions are not needed for the core protocol. However, type 3 signals can optionally carry version metadata for inspector/devtools purposes:

```ts
sink(3, { signal: DIRTY, version: 7 })    // inspector logs "cycle 7 started"
sink(3, { signal: RESOLVED, version: 7 }) // inspector logs "cycle 7: no change"
```

This is observability metadata, not a correctness mechanism. The core protocol uses `dirtyDeps: Set<depIndex>` for all tracking.

---

## Mixed state + stream deps (Option 2 + Option 3)

When a derived depends on both state-aware sources and pure callbag sources (streams without DIRTY):

**Option 2 — Transparent forwarding:** Callbag operators forward unknown types (including type 3). This means DIRTY propagates through operator chains like `pipe(state, take(5), map(fn))` without operators needing to understand DIRTY.

**Option 3 — Unexpected DATA handling:** If type 1 DATA arrives from a dep that isn't in `dirtyDeps` (never sent DIRTY), treat it as an immediate trigger — recompute right away.

Together:
- State deps coordinate via DIRTY/RESOLVED. Diamond resolution works.
- Pure stream deps trigger immediate recomputation. No glitch-free guarantee for that dep, but correct final values.
- This naturally handles mixed dependency graphs without special casing.

---

## Tier 2 operators (Producer-based)

Complex operators that involve async, timers, or dynamic subscriptions are built as Producers with `{ autoDirty: false }`:

```ts
function switchMap<A, B>(source: Store<A>, fn: (a: A) => Store<B>): Store<B> {
  return producer<B>(({ emit, signal }) => {
    let innerUnsub: (() => void) | undefined;
    const outerUnsub = subscribe(source, (value) => {
      innerUnsub?.();
      signal(DIRTY);
      const inner = fn(value);
      innerUnsub = subscribe(inner, (v) => emit(v));
    });
    return () => { innerUnsub?.(); outerUnsub(); };
  }, { autoDirty: false });
}

function debounce<A>(source: Store<A>, ms: number): Store<A> {
  return producer<A>(({ emit }) => {
    let timer: any;
    const unsub = subscribe(source, (value) => {
      clearTimeout(timer);
      timer = setTimeout(() => emit(value), ms);  // autoDirty: true (default)
    });
    return () => { clearTimeout(timer); unsub(); };
  });
}
```

These are cycle boundaries. Each `emit` starts a new DIRTY+value cycle (when autoDirty is true) or the user manually controls signals (when autoDirty is false). This matches RxJS behavior — time-based and dynamic-subscription operators are natural glitch boundaries.

---

## Impact on existing modules

### pipe / pipeRaw

`pipe()` chains operators. Each operator is a tier 1 Operator node. Type 3 signals flow through the chain via transparent forwarding.

`pipeRaw()` fuses transforms into a single derived store. Works as before — the fused derived handles DIRTY tracking for its single upstream dep.

### Extra modules

| Category | Examples | Tier | Implementation |
|----------|----------|------|----------------|
| Simple passthrough | take, skip, tap, distinctUntilChanged, pairwise | 1 | Operator — forward type 3, transform type 1 |
| Stateful transform | map, filter, scan | 1 | Operator — forward type 3, transform type 1 |
| Multi-source | combine, merge | 1 | Operator with multiple deps — dirty tracking like derived |
| Event sources | interval, fromEvent, fromPromise, fromObs | 1 | Producer (autoDirty: true) |
| Time-based | debounce, throttle, delay, sample | 2 | Producer — timer-based cycle boundaries |
| Dynamic subscription | switchMap, flat, concatMap, exhaustMap | 2 | Producer (autoDirty: false) — manages inner subscriptions |
| Error handling | rescue, retry | 2 | Producer (autoDirty: false) — manages subscription lifecycle |
| Simple sinks | forEach, subscribe | - | Callbag sink — type 1 only, no state participation |

### What's eliminated

- `enqueueEffect()` — effects run inline when deps resolve
- `pendingValueEmitters[]` — no phase 2 queue; values emit directly after DIRTY
- `emittingValues` flag — not needed
- `flushing` flag — not needed
- `DIRTY` sentinel on type 1 — moved to type 3
- `pending` flag in subscribe — not needed; DATA is always a real value

### What's simplified

- `batch()` — just `batchDepth` + `deferredEmissions[]` (2 pieces of global state, down from 5)
- `subscribe` — pure callbag sink, no DIRTY awareness
- Extra operators — no two-phase rewrite needed; forward type 3, transform type 1

---

## Comparison with established libraries

| Aspect | v1 | v2 | **v3 (target)** | Preact Signals | SolidJS |
|--------|----|----|-----------------|----------------|---------|
| Data transport | Dual: DIRTY via callbag, values via get() | Single channel: DIRTY + values on type 1 | **Separated: values on type 1, signals on type 3** | Dual: flags via notify, values via refresh | Dual: flags via notify, values via updateIfNecessary |
| State graph | Same as data graph | Same as data graph | **Same callbag wiring, different message type** | Separate observer lists | Separate subscriber lists |
| Derived caching | No cache | Cached, updated on value arrival | **Cached, updated on value arrival** | Cached, lazy recompute | Cached, lazy recompute |
| Diamond solution | Deferred pull | Dep counting on single channel | **Dep counting via type 3, values on type 1** | Recursive depth-first refresh | Height-based topological sort |
| Memoization | Pull-phase only | Push-phase (emit unchanged) | **Push-phase via RESOLVED (skip entire subtree)** | Push-phase (version check) | Push-phase (equality check) |
| Effect scheduling | Global enqueueEffect | Global enqueueEffect | **Inline — runs when deps resolve via callbag** | Deferred queue | Deferred queue |
| Batch | Defers effects | Defers effects + values | **Defers type 1 emissions only** | Defers effects | Defers effects |
| Callbag compat | Partial (DIRTY on type 1) | Incompatible (DIRTY on type 1) | **Compatible (type 1 is pure values)** | N/A | N/A |
| Global state | depth + pending[] | batchDepth + 3 queues + 2 flags | **batchDepth + deferredEmissions[]** | Multiple queues | Multiple queues |

---

## File structure (projected)

```
src/
  types.ts        -- Store, WritableStore, ProducerStore, StoreOperator, Actions, Signal
  protocol.ts     -- Signal constants (DIRTY, RESOLVED), callbag type constants, batch()
  inspector.ts    -- Global singleton with WeakMaps, enabled flag
  producer.ts     -- producer() factory (general source, autoDirty option)
  state.ts        -- state() factory (sugar over producer with equality-checked set)
  operator.ts     -- operator() factory (general transform, actions API)
  derived.ts      -- derived() factory (sugar over operator with dirty tracking + cache)
  effect.ts       -- effect() factory (stateful sink, dirty tracking, inline execution)
  subscribe.ts    -- subscribe() (simple callbag sink, moves to extra/)
  pipe.ts         -- pipe() + pipeRaw(), SKIP
  index.ts        -- Public exports
```

---

## Implementation plan

### Batch 1: Core primitives

Foundation layer. Everything else depends on this. No extras touched yet.

**Files to create:**

| File | What | Notes |
|------|------|-------|
| `src/protocol.ts` | Rewrite | Signal constants (DIRTY, RESOLVED), callbag types (START, DATA, END, STATE), `batch()` with `batchDepth` + `deferredEmissions[]`. Remove `enqueueEffect`, `pushChange`, `pendingValueEmitters`, `emittingValues`, `flushing`. Keep `deferStart`/`beginDeferredStart`/`endDeferredStart` (connection batching is orthogonal). |
| `src/types.ts` | Rewrite | `Actions<T>` (emit, signal, complete, disconnect), `Signal` type, `ProducerStore<T>`, updated `Store<T>`, `WritableStore<T>`, `StoreOperator<A,B>`. Remove `StreamProducer`, `StreamStore`. |
| `src/operator.ts` | New | `operator(deps, init, opts?)` — general transform. Manages upstream connections (lazy on first sink), downstream sinks, cached value for `get()`. Calls handler with `(depIndex, type, data)` for upstream events. |
| `src/producer.ts` | New | `producer(fn?, opts?)` — general source. autoDirty option (default true). Lazy start on first sink. Exposes `emit()` externally. Replaces `stream.ts`. |
| `src/state.ts` | Rewrite | Sugar over `producer` — equality-checked `set()`, `update()`. Minimal wrapper, not a separate implementation. |
| `src/derived.ts` | Rewrite | Sugar over `operator` — multi-dep dirty tracking (Set\<depIndex\>), caching, `equals` memoization via RESOLVED. `get()` returns cache when settled, recomputes when pending or unconnected. |
| `src/effect.ts` | Rewrite | Stateful sink. Type 3 dirty tracking across deps. Runs `fn()` inline when all dirty deps resolve. No `enqueueEffect`. Eager connection on creation. |
| `src/subscribe.ts` | Simplify | Pure callbag sink — just receives type 1 DATA, runs callback. No DIRTY tracking, no pending flag. Prepare to move to `extra/` in batch 2. |
| `src/pipe.ts` | Update | `pipe()` unchanged (chains operators). `pipeRaw()` updated to use new `derived()` internals. |
| `src/index.ts` | Update | Export `producer` instead of `stream`. Export new signal constants. |

**Steps:**

1. **protocol.ts** — New signal constants + simplified batch. This unblocks everything.
2. **types.ts** — New type definitions (Actions, Signal, ProducerStore).
3. **operator.ts** — Core transform primitive. Test with a manual handler before building derived on top.
4. **producer.ts** — Core source primitive. Test emit, signal, complete, autoDirty, lazy start.
5. **derived.ts** — Rewrite on top of operator. Verify diamond resolution, RESOLVED propagation, `equals` memoization.
6. **state.ts** — Rewrite as sugar over producer. Verify equality-checked set.
7. **effect.ts** — Rewrite with type 3 dirty tracking, inline execution.
8. **subscribe.ts** — Simplify to pure callbag sink.
9. **pipe.ts** — Update pipeRaw to use new derived internals.
10. **index.ts** — Update exports.

**Tests (update existing + new):**

| Test file | What to update |
|-----------|---------------|
| `basics.test.ts` | Core primitives: state, derived, effect, subscribe, batch. Replace `stream` with `producer`. |
| `two-phase.test.ts` | Rename to `type3-signals.test.ts`. Verify type 3 DIRTY/RESOLVED flow instead of type 1 DIRTY. Verify diamond resolution. Verify inline effect execution. |
| `signals.test.ts` | Signals compat: state set/get, derived caching, equals memoization. |
| `callbag.test.ts` | Verify type 1 is pure values. Verify type 3 forwarding convention. Test external callbag operator interop. |

**Definition of done for batch 1:**
- All core tests pass
- Diamond resolution works via type 3 DIRTY + dep-identity tracking
- RESOLVED skips subtree computation
- `batch()` defers only type 1 emissions
- Effects run inline (no `enqueueEffect`)
- `subscribe` has no DIRTY awareness
- No global state besides `batchDepth` + `deferredEmissions[]`

---

### Batch 2: Tier 1 extras

Passthrough operators, stateful transforms, multi-source operators, and event sources. All tier 1 — they participate in type 3 signaling and are glitch-free in diamond topologies.

**Passthrough operators (rewrite as Operator):**

| Extra | Key behavior | Type 3 handling |
|-------|-------------|-----------------|
| `take(n)` | Forward first n values, then disconnect + complete | Forward signals while count < n |
| `skip(n)` | Suppress first n values | Forward signals when count >= n, send RESOLVED when suppressing |
| `tap(fn)` | Side-effect on each value, no transform | Forward all signals and values unchanged |
| `distinctUntilChanged(eq?)` | Suppress consecutive duplicates | Forward DIRTY, send RESOLVED when duplicate detected on type 1 |
| `pairwise()` | Emit [prev, current] pairs | Forward signals, emit pair on type 1 after first value |
| `startWith(value)` | Prepend initial value | Forward signals, initial value set via `opts.initial` |
| `takeUntil(notifier)` | Forward until notifier emits | Multi-dep operator: dep 0 = source, dep 1 = notifier. Disconnect + complete on notifier type 1 |
| `remember()` | Cache last value (replay to new sinks) | Forward signals, cache on type 1. (May be redundant since Operator already caches for `get()`) |

**Stateful transforms (rewrite as Operator):**

| Extra | Key behavior | Type 3 handling |
|-------|-------------|-----------------|
| `map(fn)` | Transform each value | Forward signals, transform on type 1 |
| `filter(pred)` | Conditionally forward | Forward DIRTY, emit or RESOLVED on type 1 based on predicate |
| `scan(fn, seed)` | Accumulate values | Forward signals, accumulate and emit on type 1 |

Note: `map`, `filter`, `scan` currently live in `pipe.ts` as `StoreOperator` wrappers around `derived()`. Rewrite as standalone Operators in `extra/`, keep `pipe.ts` wrappers that delegate to them.

**Multi-source operators (rewrite as Operator with multi-dep):**

| Extra | Key behavior | Type 3 handling |
|-------|-------------|-----------------|
| `combine(...sources)` | Emit tuple when any source changes | Dirty tracking like derived — count dirty deps, wait for all, emit tuple |
| `merge(...sources)` | Emit from whichever source fires | Forward signals from each dep independently, emit each value |
| `concat(...sources)` | Sequential: subscribe to next source when current completes | Single active dep at a time, forward its signals |

**Event sources (rewrite as Producer):**

| Extra | Implementation | autoDirty |
|-------|---------------|-----------|
| `interval(ms)` | `producer` + `setInterval` | true (default) |
| `fromEvent(target, event)` | `producer` + `addEventListener` | true |
| `fromPromise(promise)` | `producer` + `.then()` + `complete()` | true |
| `fromObs(observable)` | `producer` + `observable.subscribe()` | true |
| `fromIter(iterable)` | `producer` + iterate on start | true |

**Other tier 1:**

| Extra | Implementation | Notes |
|-------|---------------|-------|
| `subject()` | `producer` with exposed `next()` / `complete()` | Multicast source. `next()` = `emit()`. |
| `share(source)` | Operator or refcount wrapper | Share upstream subscription across multiple sinks |
| `buffer(notifier)` | Operator with 2 deps | Buffer source values, emit array on notifier. Dep 0 = source, dep 1 = notifier |
| `forEach(source, fn)` | Pure callbag sink | Like subscribe but no prev tracking. Move subscribe here too. |

**Steps:**

1. Rewrite passthrough operators: take, skip, tap, distinctUntilChanged, pairwise, startWith, takeUntil, remember
2. Rewrite stateful transforms: map, filter, scan (in `extra/`, update `pipe.ts` to delegate)
3. Rewrite multi-source: combine, merge, concat
4. Rewrite event sources: interval, fromEvent, fromPromise, fromObs, fromIter
5. Rewrite subject as producer wrapper
6. Rewrite share, buffer
7. Move subscribe + forEach to `extra/`
8. Update `extra/index.ts` exports

**Tests (update existing + new):**

| Test file | What to update |
|-----------|---------------|
| `extras-tier1.test.ts` | All tier 1 extras: verify type 3 forwarding, value transformation, completion |
| New: `extras-diamond.test.ts` | Diamond topology tests for each tier 1 operator: verify exactly-once computation downstream |
| New: `extras-resolved.test.ts` | RESOLVED propagation: filter suppression, distinctUntilChanged, equals — verify subtree skipping |

**Definition of done for batch 2:**
- All tier 1 extras rewritten as Operator or Producer
- Each passthrough operator forwards type 3 signals
- Diamond resolution works through tier 1 operator chains
- RESOLVED propagation works (filter, distinctUntilChanged)
- subscribe and forEach live in `extra/`
- No DIRTY handling on type 1 in any tier 1 extra

---

### Batch 3: Tier 2 extras

Time-based operators, dynamic subscription operators, and error handling. All tier 2 — they are cycle boundaries built as Producers.

**Time-based operators (Producer, autoDirty: true):**

| Extra | Implementation | Notes |
|-------|---------------|-------|
| `debounce(ms)` | Producer + subscribe to source + `setTimeout` | Timer-based, each emit starts new cycle |
| `throttle(ms)` | Producer + subscribe to source + `setTimeout`/leading-edge | Timer-based |
| `delay(ms)` | Producer + subscribe to source + `setTimeout` per value | Timer-based |
| `timeout(ms)` | Producer + subscribe to source + `setTimeout` | Errors if no value within ms |
| `bufferTime(ms)` | Producer + subscribe to source + `setInterval` | Timer-based batching |
| `sample(notifier)` | Producer + subscribe to source + subscribe to notifier | Emit latest source value on notifier |

**Dynamic subscription operators (Producer, autoDirty: false):**

| Extra | Implementation | Notes |
|-------|---------------|-------|
| `switchMap(fn)` | Producer + subscribe outer + subscribe inner | Manual signal(DIRTY) on outer change |
| `flat(source)` | Producer + subscribe outer + subscribe inner | Flattens inner sources |
| `concatMap(fn)` | Producer + subscribe outer + queue inner | Sequential inner subscriptions |
| `exhaustMap(fn)` | Producer + subscribe outer + ignore while active | Ignore outer while inner active |

**Error handling (Producer, autoDirty: false):**

| Extra | Implementation | Notes |
|-------|---------------|-------|
| `rescue(fn)` | Producer + subscribe, catch errors, switch to fallback | Manual signal control |
| `retry(opts)` | Producer + subscribe, resubscribe on error | Manual signal control |

**Steps:**

1. Rewrite time-based operators: debounce, throttle, delay, timeout, bufferTime, sample
2. Rewrite dynamic subscription operators: switchMap, flat, concatMap, exhaustMap
3. Rewrite error handling: rescue, retry
4. Update `extra/index.ts` exports

**Tests (update existing + new):**

| Test file | What to update |
|-----------|---------------|
| `extras-tier2.test.ts` | Time-based extras: verify timer behavior, cycle boundary semantics |
| `extras-tier2-operators.test.ts` | Dynamic subscription + error handling extras |
| New: `extras-cycle-boundary.test.ts` | Verify tier 2 operators start new DIRTY cycles. Verify they don't passthrough type 3 from upstream. Document expected glitch counts in diamond topologies. |

**Definition of done for batch 3:**
- All tier 2 extras rewritten as Producer-based
- Time-based operators use autoDirty: true (each emit is a full cycle)
- Dynamic subscription operators use autoDirty: false (manual signal control)
- Cycle boundary behavior is tested and documented
- All existing test suites pass

---

### Batch 4: Validation and cleanup

Final validation, performance verification, and documentation.

**Steps:**

1. **Inspector update** — Update inspector to understand new primitive kinds (producer, operator). Verify graph traversal works with type 3 signals.
2. **Callbag interop test** — Write tests using raw external callbag operators in a pipe chain. Verify type 1 values flow correctly and type 3 signals forward via the transparent convention.
3. **Benchmarks** — Run existing benchmarks against v2 baseline. Verify no regression. Measure improvement from eliminated global queues and inline effect execution.
4. **Delete dead code** — Remove old `stream.ts`. Remove `pushChange`, `enqueueEffect`, `pendingValueEmitters`, `emittingValues`, `flushing` from protocol. Remove old DIRTY-on-type-1 handling from any remaining files.
5. **Update CLAUDE.md** — Update architecture section to reflect v3 primitives, type 3 control channel, tier model, and new file structure.
6. **Update docs/** — Archive `architecture-v2.md`. Promote `architecture-v3.md` to `architecture.md`. Update `extras.md`, `optimizations.md`, and `examples-plan.md` for new APIs.

**Tests:**

| Test file | What to update |
|-----------|---------------|
| `inspector.test.ts` | New primitive kinds, graph traversal |
| `optimizations.test.ts` | pipeRaw with new derived, SKIP sentinel |
| New: `interop.test.ts` | External callbag operator compatibility |
| All test files | Final pass — ensure no references to old APIs (pushChange, enqueueEffect, stream) |

**Definition of done for batch 4:**
- Zero references to removed APIs in src/ or tests/
- All test suites green
- Benchmarks show no regression (ideally improvement from reduced global coordination)
- CLAUDE.md and docs/ fully updated
- `architecture-v3.md` promoted to `architecture.md`
