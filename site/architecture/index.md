---
outline: [2, 3]
---

# Architecture

> **Status:** Canonical design document. The output slot model, status model, and disconnect-on-unsub
> derived are implemented and shipped. This is the definitive architecture reference.

---

## 1. Core Principles

1. **Every node has a store.** Sources, transforms, and sinks all maintain `_value` and `_status`. This is the foundation of inspectability and ETL — any node in the graph can be read at any time via `.get()`.

2. **Three roles, not three primitives.** The fundamental callbag roles are source, transform, sink. Every node is one of these. `state` and `derived` are user-facing sugar; `producer`, `operator`, and `effect` are the implementation primitives.

3. **The chain is a mental model, not a literal composition.** Each transform node conceptually wires its deps through its transform and a tap that keeps its own store current. In practice, the stages (state tracking → transform → value caching → output dispatch) are inlined into dep subscription handler closures for zero-allocation performance. Downstream nodes subscribe via `source()`, not to a composed callbag function.

4. **A tap keeps every node's store current.** Even when a downstream node is driving the pipeline, the handler closure fires on every DATA and STATE signal passing through. The node's `_value` and `_status` are always up to date — no separate upstream subscription needed just for self-observation.

5. **Type 1 DATA carries only real values.** Never sentinels. DIRTY, RESOLVED, and other control signals live exclusively on type 3 STATE.

6. **Type 3 STATE is forwarded, not swallowed.** Unknown signals pass through downstream unchanged. This ensures forward-compatibility (PAUSE, RESUME, etc.).

7. **DIRTY before DATA, always.** Phase 1: DIRTY propagates downstream. Phase 2: DATA follows. `autoDirty: true` handles this automatically for producers.

8. **RESOLVED means "I was dirty, value didn't change."** Only sent if a DIRTY was sent in the same cycle. Never sent to suppress a value that was never promised.

9. **Bitmask at convergence points only.** Dirty-dep counting (bitmask) is only needed at nodes with multiple deps (diamonds). Linear single-dep chains carry DIRTY straight through — no counting needed.

10. **Batch defers DATA, not DIRTY.** DIRTY propagates immediately during `batch()`. DATA is deferred to the outermost batch exit. Diamond resolution works in batches because the full dirty state is established before any values flow.

11. **Completion is terminal.** After a node completes or errors, it emits nothing further. `resubscribable` is the only exception.

12. **Effects run inline.** When all dirty deps resolve, the effect fn runs synchronously. No scheduler.

13. **Compatibility targets: TC39 Signals, raw callbag, RxJS.**

---

## 2. Folder & Dependency Hierarchy

`derived` and `operator` are separate files with converged internals.

```
src/
├── core/
│   ├── protocol.ts  ← type constants, batch, deferStart — no other core imports
│   ├── types.ts     ← Store, WritableStore, Actions, NodeStatus — no runtime imports
│   ├── inspector.ts ← observability singleton — imports protocol only
│   ├── producer.ts  ← source role — imports protocol + inspector + types
│   ├── state.ts     ← syntax sugar over producer
│   ├── operator.ts  ← transform role — imports protocol + inspector + types
│   ├── derived.ts   ← syntax sugar over operator with terminator management
│   ├── effect.ts    ← sink role — imports protocol + types
│   └── pipe.ts      ← map/filter/scan sugar via derived
├── extra/           ← operators, sources, sinks — import from core only
└── index.ts         ← public API barrel
```

**Strict rules** (unchanged):
- `core/` never imports from `extra/`
- `extra/` imports from `core/` only, never from each other
- `protocol.ts` and `types.ts` have zero runtime dependencies on other core files

---

## 3. Protocol: Type Constants & Signal Vocabulary

```ts
const START = 0;   // Callbag handshake
const DATA  = 1;   // Real values only — never sentinels
const END   = 2;   // Completion (no payload) or error (payload = error)
const STATE = 3;   // Control signals: DIRTY, RESOLVED. Future: PAUSE, RESUME.

const DIRTY    = Symbol("DIRTY");     // "My value is about to change."
const RESOLVED = Symbol("RESOLVED"); // "I was dirty, value didn't change."
```

**Direction — the graph is a DAG:**
```
sources → transforms → sinks   (DOWNSTREAM: DATA, DIRTY, RESOLVED, END)
sources ← transforms ← sinks   (UPSTREAM: talkback(END) = unsubscribe only)
```

**Two-phase push:**
```
sink(STATE, DIRTY)    // phase 1: "prepare"
sink(DATA, value)     // phase 2: "new value"
sink(STATE, RESOLVED) // alternative phase 2: "no change"
```

**Node status:**

Every node tracks its own `_status`:

| Status | Meaning | Trigger |
|--------|---------|---------|
| `DISCONNECTED` | No downstream, deps not connected | No subscribers, operator not yet activated |
| `DIRTY` | DIRTY received, waiting for DATA | Incoming STATE DIRTY |
| `SETTLED` | DATA received, value computed and cached | Incoming DATA (after computation) |
| `RESOLVED` | Was dirty, value confirmed unchanged | Incoming STATE RESOLVED |
| `COMPLETED` | Terminal — complete() was called | END without payload |
| `ERRORED` | Terminal — error() was called | END with error payload |

These statuses are written by the handler closures (see §5 conceptual model).

> **Note:** `resubscribable` is a producer **option flag**, not a status. It allows a COMPLETED or ERRORED node to accept new subscribers and re-run from its `_start()` function. The status becomes DISCONNECTED again when a new subscriber arrives.

---

## 4. Node Roles

Every node has one of three callbag roles. `state` and `derived` are syntax sugar — they compile down to producer and operator respectively.

### Source (`producer`) — originates values

- Has no deps
- Maintains `_value` and exposes `get()` / `source()`
- `state(initial)` = producer with `set()` / `update()` sugar and `equals: Object.is`
- Emits DIRTY then DATA on change; emits RESOLVED if `equals` guard fires

### Transform (`operator` / `derived`) — receives deps, produces output

- Has one or more deps
- Maintains `_value` (last computed output) and `_status`
- Dep subscription handlers inline state tracking, transform, value caching, and dispatch (see §5 conceptual model)
- Exposes `get()` and `source()` — is a full store, subscribable by anything downstream
- `derived([deps], fn)` = operator with disconnect-on-unsub behavior and pull-compute `get()` (see §6)

### Sink (`effect`) — terminal, no downstream

- Has deps, tracks DIRTY/RESOLVED, runs `fn()` when deps settle
- Has no `get()` or `source()` — not a store, not subscribable
- Always the end of a graph path
- Returns `dispose()` — the only way to disconnect
- Implemented as a pure closure (no class, no hidden class overhead)

---

## 5. The Chain Model (Conceptual)

This is the central mental model. The stages described here are **not** composed as separate callbag functions — they are inlined into dep subscription handler closures for zero-allocation performance. The conceptual model accurately describes the signal flow.

### Signal flow through a transform node

Every transform node B (derived, operator) processes signals through these conceptual stages:

```
dep.source → state tracking → transform(fn) → value caching → output dispatch
```

In implementation, `_connectSingleDep()` and `_connectMultiDep()` contain all of these stages as inline logic within one closure. There is no `_chain` property on the class, and no `B.sources` array.

### State tracking stage

Fires on STATE signals, updates `B._status`, then forwards the signal downstream unchanged:

```
STATE DIRTY    → B._status = DIRTY;    forward DIRTY downstream
STATE RESOLVED → B._status = RESOLVED; forward RESOLVED downstream
STATE unknown  → forward unchanged (required for forward-compat)
END            → B._status = DISCONNECTED; forward END downstream
```

### Value caching stage

Fires on DATA after the transform, writes to `B._cachedValue`, then dispatches downstream:

```
DATA value → B._cachedValue = value; B._status = SETTLED; dispatch to output slot
```

### Why the tap is always active

When connected (has subscribers), the handler closure captures `this` and always writes to `_cachedValue`/`_status`. `_dispatch()` routes to the output slot. When disconnected (no subscribers), deps are disconnected and `get()` pull-computes from deps on demand — always returning a fresh value.

---

## 6. The Output Slot

Every transform node B has an **output slot** (`_output`). The output slot is the multicast dispatch point — it routes every DATA/STATE/END signal to whoever is currently subscribed to B. This replaces subscriber-count bookkeeping and avoids any involvement of upstream nodes in topology changes.

The output slot is purely a dispatch point. Dep connections and downstream dispatch are independent concerns — no handoff protocol is needed.

A itself is always completely unaware of what happens at the output slot.

### Output slot mode transitions

```
DISCONNECTED ──[subscriber arrives]──→ SINGLE ──[2nd subscriber]──→ MULTI
    ↑                                      |                           |
    └──[last subscriber leaves]────────────┘                           |
    ↑                                                                  |
    └──[last subscriber leaves]────────────────────────────────────────┘
```

### Mode 0: DISCONNECTED

When B has no external subscribers (both `derived` and `operator`):

- `_output = null`
- Dep connections are disconnected — no upstream subscriptions active
- `B.get()` pull-computes: calls each dep's `.get()`, applies `fn`, returns the result (always fresh)
- Pull-compute does NOT write to `_cachedValue` — it is a read-only on-demand computation

> **Why derived and operator behave the same when disconnected:**
> Both disconnect from deps when the last subscriber leaves. `derived.get()` pull-computes
> from deps on demand, so callers always get a fresh value without maintaining active
> subscriptions. `operator` behaves similarly — lazy until subscribed to.

### Mode 1: SINGLE

When the first external subscriber C subscribes to B:

1. `_output = sink` (C's sink function)
2. Connect to deps (subscribe to upstream sources)
3. B's handler closure fires on upstream signals — `_cachedValue` and `_status` are kept current

C receives a talkback. Calling `talkback(END)` removes C from the output slot.

### Mode 2: MULTI

When a second subscriber D subscribes while C is already in the slot:

1. `_output` switches from a single sink function to `Set{C, D}`
2. Emissions dispatch to all sinks in one pass
3. Additional subscribers just join the Set — no upstream restructuring
4. Each `talkback(END)` removes only that specific sink from the Set

**Key:** A never gets an additional subscriber. The only topology change is in the output slot. This is the decisive advantage: topology changes are O(1) and source-agnostic.

### DISCONNECTED

When the last external subscriber leaves:

- For both `derived` and `operator`: `_output = null`, `_status = DISCONNECTED`, deps disconnected
- `_cachedValue` is retained but stale — `derived.get()` pull-computes fresh from deps instead of returning the cached value

### Why ADOPT isn't needed

The ADOPT protocol (REQUEST_ADOPT/GRANT_ADOPT handshake) was designed for a model where derived nodes hold an "internal terminator" in the output slot, requiring a handoff when external subscribers arrive. The actual implementation sidesteps this:

- Dep connections are established on first subscriber and torn down on last subscriber leaving
- The output slot is purely a dispatch point: `null → fn → Set`
- Subscriber arrival/departure is mechanical — no upstream awareness or signaling needed

The `REQUEST_ADOPT`/`GRANT_ADOPT` symbols have been removed from `protocol.ts`.

---

## 7. `.get()` Semantics

`.get()` returns a meaningful value at all times. When disconnected, `get()` pull-computes from deps (always fresh). When `_status` is DIRTY, `.get()` also communicates staleness — it does not silently return a stale value as if it were fresh.

| Status | `.get()` behavior |
|--------|-------------------|
| `SETTLED` | Return `_value` — definitely current |
| `RESOLVED` | Return `_value` — guaranteed unchanged from last SETTLED |
| `DIRTY` | Return `_value` alongside a staleness indicator (exact API TBD — see below) |
| `DISCONNECTED` | Pull-based recompute: call each dep's `.get()`, apply `fn`, return result |
| `COMPLETED` / `ERRORED` | Return `_value` — last value before terminal; `_status` communicates terminal state |

**Honest DIRTY feedback** — when `_status === DIRTY`, a new value is in flight. Silently returning `_value` misleads callers. Options for the API shape:
- `inspect()` → `{ status, value }` for callers that need to distinguish fresh vs. stale
- `get()` returns `_value` as-is (compatible with existing usages); staleness queryable via `node._status`
- Future: `getLive()` forces a synchronous upstream pull to return the real-time value

The chosen approach is: `.get()` returns `_value` for compatibility; `_status` is always publicly readable; `Inspector.inspect()` surfaces both together. The full pull-propagation design for a `getLive()` is deferred.

**DISCONNECTED pull recompute** does NOT write to `_value`. It is a read-only on-demand computation. `_value` only reflects values that actually flowed through the connected pipeline.

---

## 8. Diamond Resolution

Diamond resolution works correctly via the bitmask algorithm applied at convergence points (multi-dep nodes).

### Example: C depends on [A, B] where B depends on A

C connects to both deps:
- dep 0: A.source directly
- dep 1: B.source (which internally flows through A → B's handler → B's output slot)

A gets two sinks (C's direct connection + B's upstream connection).

**Signal flow:**
1. A sends DIRTY → flows to C's dep-0 connection → C sets bit 0 → `dirtyDeps = 0b01` → C forwards DIRTY downstream (first dirty dep)
2. A sends DIRTY → flows through B's handler → B._status = DIRTY → B dispatches DIRTY → arrives at C's dep-1 connection → C sets bit 1 → `dirtyDeps = 0b11` → idempotent (DIRTY already forwarded)
3. A sends DATA → flows through B's handler → B computes fn, B._cachedValue updated, B._status = SETTLED → B dispatches DATA → arrives at C's dep-1 → C clears bit 1 → `dirtyDeps = 0b01` → not 0, wait
4. A sends DATA → also arrives at C's dep-0 directly → C clears bit 0 → `dirtyDeps = 0` → recompute: `fn(A.get(), B.get())` — both values are current

C computes exactly once. B._cachedValue is updated via its handler closure. Diamond resolution holds.

**Key:** The bitmask waits for both paths. The ordering (which DATA arrives first) doesn't matter. Correctness is guaranteed by waiting for all bits to clear.

### Bitmask algorithm (applied at multi-dep nodes only)

The `Bitmask` class (`core/bitmask.ts`) provides per-dep dirty tracking safe for any number of deps:

- **≤32 deps:** stores the bitmask as a plain number (`_v`). Bitwise ops on a single 32-bit integer — zero overhead.
- **>32 deps:** stores bits in a `Uint32Array` (`_w`), with `_v` tracking the count of set bits. `empty()` is O(1) via the count rather than scanning words.

In both cases `empty()` is a single `_v === 0` comparison. Method dispatch is monomorphic (one class, one hidden class for all instances).

```ts
const dirtyDeps = new Bitmask(deps.length);

// On STATE DIRTY from depIndex:
const wasClean = dirtyDeps.empty();
dirtyDeps.set(depIndex);
if (wasClean) signal(DIRTY);           // forward on first dirty dep only

// On STATE RESOLVED from depIndex:
if (dirtyDeps.test(depIndex)) {
  dirtyDeps.clear(depIndex);
  if (dirtyDeps.empty()) signal(RESOLVED); // all resolved without DATA
}

// On DATA from depIndex:
dirtyDeps.clear(depIndex);             // clear bit; no-op if not set (raw callbag)
if (dirtyDeps.empty()) recompute();    // act only when all deps resolved
```

**Single-dep chains:** No bitmask. Forward every DIRTY directly.

---

## 9. Signal Handling Reference

### Direction (unchanged)

- **DIRTY, RESOLVED, DATA, END** → downstream
- **talkback(END)** → upstream (unsubscribe only)

### What each node does with each signal

| Signal | producer (source) | operator / derived (transform) | effect (sink) |
|--------|------------------|-------------------------------|---------------|
| STATE DIRTY received | N/A (source) | stateIntercept → update `_status = DIRTY`; single-dep: forward; multi-dep: bitmask → forward if first | Track in bitmask; do NOT forward |
| STATE RESOLVED received | N/A | stateIntercept → update `_status = RESOLVED`; single-dep: forward; multi-dep: bitmask → if 0, forward | Bitmask → if 0, skip fn() |
| STATE unknown received | N/A | **Forward downstream unchanged — no exceptions** | Ignore (terminal) |
| DATA received | N/A | valueIntercept → `_value = computed`; `_status = SETTLED`; single-dep: forward; multi-dep: bitmask → if 0, compute+forward | Bitmask → if 0, run fn() |
| END (completion) received | N/A | `_status = DISCONNECTED`; complete() → disconnect upstream, notify sinks | cleanup(); disconnect from all talkbacks |
| END (error) received | N/A | `_status = DISCONNECTED`; error(e) → disconnect upstream, notify sinks with error | cleanup(); disconnect from all talkbacks |
| DIRTY sent | `signal(DIRTY)` before `emit()` | `signal(DIRTY)` downstream (from bitmask or single-dep forward) | N/A |
| RESOLVED sent | `signal(RESOLVED)` when equals guard | `signal(RESOLVED)` when suppressing or all-RESOLVED bitmask | N/A |
| DATA sent | `emit(value)` | emit computed value downstream | N/A |

### Tier 2 extras (cycle boundaries)

Tier 2 nodes (debounce, switchMap, etc.) use `subscribe()` internally, which is a callbag sink that receives only DATA (type 1). Tier 2 nodes do not receive DIRTY/RESOLVED from upstream. Each `emit()` starts a fresh DIRTY+DATA cycle via `autoDirty: true`. Tier 2 always produces DATA — upstream nodes always get a tap event when tier 2 fires.

### DATA without prior DIRTY (raw callbag compat)

When a dep sends DATA without having sent DIRTY (raw callbag source with no type 3 support):

```ts
// Applied universally to operator, derived, effect:
if (type === DATA) {
  dirtyDeps &= ~(1 << depIndex); // clear bit if set; no-op if not (raw callbag case)
  if (dirtyDeps === 0) recompute(); // wait for all known-dirty deps
}
```

Values from raw callbag deps are captured by calling `dep.get()` inside `recompute()` — the dep's value is current even if no DIRTY was sent.

---

## 10. Lifecycle: Startup, Teardown, Cleanup, Reconnect

### Construction (startup)

**Construction time** — runs once when the node is created:

```
derived([A], fn) or operator([A], init):
  1. Initialize all instance properties (_cachedValue, _status, _flags, _output, etc.)
  2. Connect to deps:
       Single-dep: _connectSingleDep() — inline handler closure
       Multi-dep:  _connectMultiDep()  — inline handler with bitmask logic
  3. Both derived and operator: wait for first external subscriber (lazy connection)
  4. Register with Inspector: kind, name, initial value
```

**Connection time** — runs each time a subscriber arrives:
- Allocate handler-local state: counters, accumulators, skip counts, flags
- This is the equivalent of `init()` running fresh in the operator handler

**Disconnection time** — runs when all subscribers leave:
- Release handler-local state
- Both `derived` and `operator`: disconnect from deps, no reconnect until next subscriber; state is gone
- `derived.get()` pull-computes on demand when disconnected (always fresh)

Behavioral state (counters, queues) resets cleanly on each new subscription session.

### Connection batching

`beginDeferredStart()` / `endDeferredStart()` queues all chain activations. They fire together at `endDeferredStart()`, ensuring a subscriber's baseline is captured before any producer starts emitting.

### Teardown (last subscriber leaves)

```
talkback(END) ← upstream from subscriber
  → remove subscriber from output slot
  → if output slot empty:
      _output = null, _status = DISCONNECTED, disconnect from deps
      // _cachedValue retained but stale — derived.get() pull-computes fresh from deps
```

### Completion/error teardown

```
complete() or error(e):
  → if completed: return                          // idempotency guard
  → completed = true
  → B._status = DISCONNECTED
  → for each talkback: talkback(END)              // disconnect upstream
  → talkbacks = []
  → localOutput = _output; _output = null          // null before notifying
  → _stop()                                       // cleanup BEFORE notifying
  → for each sink: sink(END) or sink(END, e)      // notify downstream
```

**Cleanup before notification:** ensures `resubscribable` re-subscription finds a clean state.

### Reconnect

- **derived**: disconnects from deps when all subscribers leave. Reconnects when a new subscriber calls `source(START, ...)`. `get()` pull-computes when disconnected.
- **operator**: same as derived — reconnects when a new subscriber calls `source(START, ...)`. `init()` re-runs, handler-local state resets.
- **producer**: `_start()` re-runs on new subscriber after last left. If `resetOnTeardown`, `_value` resets.
- **effect**: no reconnect. Dispose and create new.
- **Completed nodes**: reject new subscribers (immediate START + END) unless `resubscribable`.

---

## 11. Where to Put Guards, Stops, Passthroughs, Switches

### Guard placement (unchanged)

```ts
return (depIndex, type, data) => {
  if (completed) return;        // ALWAYS first
  if (type === STATE) { ... }
  if (type === DATA) { ... }
  if (type === END) { ... }
};
```

### Passthrough convention (unchanged)

```ts
if (type === STATE) signal(data);        // forward all STATE, no exceptions
if (type === DATA)  emit(transform(data));
if (type === END)   data ? error(data) : complete();
```

### RESOLVED when suppressing (unchanged)

Operators that reject DATA (filter, distinctUntilChanged) MUST send `signal(RESOLVED)`. Silence leaves downstream bitmasks in a permanently waiting state.

### Dynamic upstream = tier 2

Dynamic upstream (dep changes at runtime) is a tier 2 pattern — use producer + subscribe. Operator deps are static. Sync inner completion race guard (`innerEnded` flag) is required. See §8 of the implementation guide.

---

## 12. Resource Allocation & Cleanup

Every tier 2 extra must clean up all resources it allocates. The chain model does not change this — tier 2 nodes are producers, not operators, and their cleanup happens in the producer's `_stop()`.

| Resource | Cleanup |
|----------|---------|
| `setInterval` | `clearInterval(id)` |
| `setTimeout` | `clearTimeout(id)` |
| `addEventListener` | `removeEventListener(event, handler)` |
| `subscribe()` return | `unsub()` |
| Inner callbag talkback | `talkback(END)` |
| Inner store subscription | `innerUnsub?.()` |
| Pending promise | `cancelled = true` flag |
| Observable subscription | `subscription.unsubscribe()` |

---

## 13. Operator Behavioral Compatibility

### Default: follow RxJS

For any operator with an RxJS equivalent, match RxJS semantics. See [rxjs.dev/api](https://rxjs.dev/api). Do not guess.

### Documented divergences from RxJS

| Behavior | RxJS | callbag-recharge | Reason |
|----------|------|---------------------|--------|
| Value suppression | No emission | Must send `signal(RESOLVED)` | Downstream bitmasks need clearing |
| `filter` non-match | No emission | `signal(RESOLVED)` | Same |
| `distinctUntilChanged` equal | No emission | `signal(RESOLVED)` | Same |
| `share()` | Adds refcounting | No-op | Stores are inherently multicast |
| Completion ordering | Notify sinks first | Cleanup first | Reentrancy safety for `resubscribable` |
| `batch()` | No equivalent | Defers DATA, DIRTY immediate | Diamond resolution across batched changes |
| `effect` | No equivalent | Inline, synchronous | No global scheduler |
| `state` completion | N/A (TC39 infinite) | Inherits from producer | Deliberate; state is a callbag, not a pure TC39 Signal |

### TC39 Signals compatibility (unchanged)

`state` matches TC39 Signal.State: `equals: Object.is` default, `set(same)` is no-op, batch defers DATA.

### Raw callbag compatibility (unchanged)

Type 1 is pure values only. Raw callbag sources feed into the graph via the "DATA without prior DIRTY" rule (§9).

---

## 14. Optimization Guidelines

### V8 hidden class: classes for hot paths

`ProducerImpl`, `DerivedImpl`, `OperatorImpl` remain as classes. All instance properties initialized in constructor, consistent shape. Output slot (`_output`) declared in the class definition to maintain hidden class stability.

```ts
class DerivedImpl<T> {
  _cachedValue: T | undefined;
  _status: NodeStatus = "DISCONNECTED";
  _output: ((type: number, data?: any) => void) | Set<any> | null = null;
  _flags: number;
  // ...
}
```

### Bitmask flags (unchanged)

Pack booleans into `_flags: number`.

### Method binding in constructor (unchanged)

Bind public API methods in constructor, not as arrow functions.

### Handler closures: zero-allocation

The dep subscription handler closures should not allocate on every signal. They capture `this` and write to `_cachedValue` and `_status` in-place — no objects created per signal.

### Snapshot-free completion (unchanged)

Null `_output` before iterating, no `[...sinks]` snapshot.

### Dep connections built once

Dep subscription handlers are created once in the constructor. The closure is assembled once and reused — no re-construction on reconnect.

### Effect as closure (unchanged)

`effect` remains a pure closure. No class. All state in closure-local variables.

---

## 15. Inspector & Debugging

### Current capabilities

```ts
Inspector.register(store, { name, kind });
Inspector.getName(store);
Inspector.getKind(store);
Inspector.inspect(store);  // { name, kind, value }
Inspector.graph();         // Map<name, StoreInfo>
Inspector.trace(store, cb); // subscribe to value changes
```

### Status tracking

Every registered store exposes `_status`. Inspector should surface this:

```ts
Inspector.inspect(store): {
  name: string | undefined;
  kind: string;
  value: unknown;
  status: "DISCONNECTED" | "DIRTY" | "SETTLED" | "RESOLVED";  // ← new
}
```

### Proposed additions (planned)

**1. Event log** — circular buffer of recent signal events:
```ts
Inspector.startRecording(maxEvents?: number): void;
Inspector.stopRecording(): void;
Inspector.events: Array<{ ts, store, kind, type, value? }>;
Inspector.dumpEvents(): string;
```

**2. Dependency edges** — registered by operator/derived during chain assembly:
```ts
Inspector.registerEdge(parent: Store, child: Store): void;
Inspector.getEdges(): Map<string, string[]>; // parent → children
```

**3. Signal hooks** — called by primitives on every emission:
```ts
Inspector.onEmit?: (store, value) => void;
Inspector.onSignal?: (store, signal) => void;
Inspector.onEnd?: (store, error) => void;
Inspector.onStatus?: (store, status) => void;  // ← new: fired when _status changes
```

**4. `Inspector.dump()`** — structured snapshot for AI-assisted debugging:
```ts
Inspector.dump(): {
  graph: Record<string, { kind, value, status, deps: string[] }>;
  recentEvents: typeof Inspector.events;
}
```

### Where handler closures register with Inspector

The dep subscription handler closures are the natural hook for `Inspector.onEmit` and `Inspector.onStatus`. They already fire on every value and every status change. Adding inspector calls is zero-cost when hooks are null:

```ts
// Inside handler closure:
node._cachedValue = computedValue;
node._status = "SETTLED";
if (Inspector.onEmit) Inspector.onEmit(node, computedValue);
if (Inspector.onStatus) Inspector.onStatus(node, "SETTLED");
```

Similarly, the STATE handling path hooks into `onSignal` and `onStatus`.

---

## 16. Raw Callbag Interop

### The interop gap

A raw callbag operator is a plain `(type, data) => void` function — it has no `source()`, no `_output`, no output slot. It's 1-to-1: one upstream, one downstream.

**The problem:** Given `A → B → C` and `A → rawOp → C`, if E wants to subscribe to `rawOp`'s output, it can't. `rawOp` has no `source()` method, no multicast capability. E would need to create a duplicate subscription to A through a second rawOp instance — duplicating the upstream path with no shared state.

### Interop wrapper

The wrapper promotes a raw callbag operator to a proper node with `source()` + output slot for multicast capability. It becomes a subscribable store that participates in the graph like any other node.

### Diamond behavior with raw operators

Raw callbag operators in diamond topologies swallow STATE signals (DIRTY/RESOLVED), causing downstream nodes to fall back to the "DATA without prior DIRTY" compat path (§9). This is correct but may cause double-computation at convergence points — the downstream node receives DATA from the raw path without a prior DIRTY, so it can't defer computation until all paths resolve.

### Raw callbag sinks (terminal)

Raw callbag sinks (terminal consumers, not operators) need no wrapping — they simply ignore STATE signals harmlessly. They receive only type 0/1/2 from the standard callbag protocol.

---

## 17. Open Questions

### 17.1 Initial value on first connection

When C subscribes, the derived connects to deps and computes its initial value. C gets a talkback that can pull the computed value via `talkback(DATA)`.

---

## 18. Summary: Decision Tree for New Extras

```
Need to implement a new extra?

1. Synchronous transform with static deps?
   YES → operator() (or derived() as sugar)
       → Handler closure inlines state tracking + transform + value caching
       → single-dep: forward every DIRTY
       → multi-dep: bitmask tracks dirty deps
       → Suppress with RESOLVED (not silence) when rejecting DATA
       → Forward unknown STATE signals always

2. Async, timer-based, or dynamic upstream?
   YES → producer() with autoDirty: true
       → Subscribe to input internally (subscribe() for DATA only)
       → Emit results as new DIRTY+DATA cycles
       → Set initial + equals to prevent spurious emissions
       → Return cleanup fn that releases all resources
       → innerEnded flag for sync inner completion race

3. Pattern shared by many operators?
   YES → Add option to producer() / operator() before duplicating boilerplate

4. Fused pipe chain?
   → pipeDerived() for always-reactive (auto-connects like derived)
   → pipeRaw() for lazy (DISCONNECTED like operator)
   → Both fuse N transforms into one derived/operator with one output slot
   → SKIP sentinel for filter semantics in both

5. None of the above?
   → Raw callbag as last resort

For all extras:
  - Verify cleanup: every exit path releases all resources
  - Verify error forwarding: upstream END with payload → error(), not complete()
  - Verify RESOLVED: every suppressed DATA must emit RESOLVED downstream
  - Verify reconnect: state resets (init re-runs for operator, fn re-runs for producer)
  - Match RxJS semantics unless in the divergences table (§13)
  - All nodes register with Inspector (kind, name); skip for inner anonymous nodes
```
