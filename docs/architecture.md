# Architecture

> **Status:** Canonical design document. The output slot model, status model, lazy
> derived (Option D3), dynamicDerived, and D5 error handling are implemented and shipped.
> This is the definitive architecture reference.

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

14. **High-level layers speak domain language, not callbag.** `core/`, `extra/`, `utils/`, and `data/` are low-level infrastructure — they expose callbag protocol, `Store` primitives, and reactive plumbing. Everything above (`orchestrate/`, `patterns/`, `adapters/`, `compat/`) must present user-friendly APIs with domain semantics (workflow steps, form fields, chat streams). If low-level internals must be accessible, lump them under an `inner` property (see `pipeline().inner` for the canonical example). Users should never need to understand DIRTY/RESOLVED, output slots, or bitmasks to use a high-level API.

---

## 2. Folder & Dependency Hierarchy

> **This is the single source of truth for import rules.** All other docs reference here.
> Each folder's `README.md` is the source of truth for its **purpose** and which functions belong there.

`derived` and `operator` are separate files with converged internals.

```
src/
├── core/            ← foundation: 6 primitives + protocol + inspector + pipe + types + bitmask
├── extra/           ← operators, sources, sinks (tier 1 + tier 2)
├── utils/           ← resilience, async, tracking, strategies (withStatus, withBreaker, retry, backoff, …)
├── data/            ← reactive data structures (reactiveMap, reactiveLog, reactiveIndex, reactiveList, pubsub)
├── orchestrate/     ← workflow nodes (pipeline, task, branch, approval, gate, taskState, executionLog)
├── memory/          ← agent memory primitives (collection, decay, node)
├── patterns/        ← composed recipes (chatStream, formField, agentLoop, textEditor, pagination, …)
├── adapters/        ← external system connectors (fromHTTP, fromWebSocket, fromLLM, fromMCP, …)
├── compat/          ← drop-in API wrappers + framework bindings (react, vue, signals, zustand, jotai, nanostores)
└── index.ts         ← public API barrel (core primitives only; other layers via subpath exports)
```

### Dependency tiers

The import hierarchy flows strictly downward. Each tier can import from its own level and below.

```
Tier 0 (foundation)   core/
                        ↓
Tier 1 (operators)    extra/
                        ↓
Tier 2 (utilities)    utils/
                        ↓
Tier 3 (domains)      orchestrate/    memory/
                        ↓                ↓
Tier 4 (surface)      patterns/    adapters/    compat/
```

`data/` is a **cross-cutting layer** — importable from any tier (core excluded).

### Strict import rules (the canonical reference)

- `core/` never imports from any other folder
- `extra/` imports from `core/` only
- `utils/` imports from `core/` and `extra/` only
- `data/` imports from `core/` and `utils/` only
- `orchestrate/` imports from `core/`, `extra/`, `utils/`, and `data/`
- `memory/` imports from `core/`, `utils/`, and `data/`
- `patterns/` imports from `core/`, `extra/`, `utils/`, `data/`, `orchestrate/`, and `memory/`
- `adapters/` imports from `core/`, `extra/`, `utils/`, `data/`, `orchestrate/`, and `memory/`
- `compat/` imports from `core/`, `extra/`, `orchestrate/`, and `memory/` only
- **Intra-folder imports are always allowed** (e.g. `retry` → `backoff` within `utils/`, `task` → `taskState` within `orchestrate/`)
- `protocol.ts` and `types.ts` have zero runtime dependencies on other core files

### Site & Demo Structure

```
site/.vitepress/theme/
├── components/
│   ├── HomeLayout.vue        ← homepage layout
│   ├── showcases/            ← hero apps: polished UI, no code panel
│   │   ├── MarkdownEditor/   ← H1: split-pane editor + live preview
│   │   ├── AIChat/           ← H2: WebLLM chat, streaming, token meter
│   │   └── WorkflowBuilder/  ← H3: code-first n8n, live DAG, persistence
│   └── examples/             ← code examples: interactive GUI + source panel
│       ├── AirflowPipeline/  ← D1: DAG execution, diamond, circuit breaker
│       ├── FormBuilder/      ← D2: formField, sync + async validation
│       ├── AgentLoop/        ← D3: agentLoop, gate, approval
│       ├── RealtimeDashboard/ ← D4: reactiveMap, sampling, eviction
│       ├── StateMachine/     ← D5: stateMachine, typed transitions
│       └── CompatComparison/ ← D6: same app in 4 state libraries
├── custom.css
└── index.ts                  ← component registration
```

**Showcases** are standalone apps — users interact with them as products. No code panel,
no "primitives used" legend. Backing state lives in `store.ts` using only library primitives.

**Examples** follow the AirflowPipeline pattern: a split-pane with interactive GUI on top
and a highlighted source panel below. Backing logic in `pipeline.ts` or `store.ts`, imported
as raw text via `?raw` for the code panel. Hover/run interactions highlight corresponding source lines.

Both tiers use the same wiring pattern: a pure `.ts` file (library only) + a `.vue` file
(bridges to Vue via `subscribe()`). No mocks — real library execution.

---

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

### Transform (`operator` / `derived` / `dynamicDerived`) — receives deps, produces output

- Has one or more deps
- Maintains `_value` (last computed output) and `_status`
- Dep subscription handlers inline state tracking, transform, value caching, and dispatch (see §5 conceptual model)
- Exposes `get()` and `source()` — is a full store, subscribable by anything downstream
- `derived([deps], fn)` = operator with lazy connect/disconnect lifecycle (see §6)
- `dynamicDerived(fn)` = derived with runtime dep discovery via tracking `get` function. Deps can change between recomputations; upstream connections are rewired via `_maybeRewire()`. Re-entrancy guard (`D_RECOMPUTING`) prevents signal cycles during rewire. Same lazy lifecycle as derived.

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

The handler closure captures `this` and always writes to `_cachedValue`/`_status`, regardless of whether `_output` has a downstream consumer. `_dispatch()` no-ops when `_output === null`, but the state/value updates still happen. When connected, whoever is downstream — a subscriber C, or a downstream effect — B's cached state stays current.

---

## 6. The Output Slot

Every transform node B has an **output slot** (`_output`). The output slot is the multicast dispatch point — it routes every DATA/STATE/END signal to whoever is currently subscribed to B. This replaces subscriber-count bookkeeping and avoids any involvement of upstream nodes in topology changes.

The output slot is purely a dispatch point. Dep connections and downstream dispatch are independent concerns — no handoff protocol is needed.

A itself is always completely unaware of what happens at the output slot.

### Output slot mode transitions

```
DISCONNECTED ──[subscriber arrives]──→ SINGLE ──[2nd subscriber]──→ MULTI
      ↑                                   |                           |
      └──[last subscriber leaves]─────────┘                           |
      ↑                                                               |
      └──[last subscriber leaves]─────────────────────────────────────┘
```

### DISCONNECTED (no subscribers)

Both `derived` and `operator` start DISCONNECTED. When B has no subscribers:

- `_output = null`
- Dep connections are inactive — B is not subscribed to any deps
- `B.get()` performs a pull-based recompute: calls `_fn()` which reads deps via closure (always-fresh), writes result to `_cachedValue`, and returns it
- No computation or connection overhead at construction — fully lazy

### Mode 1: SINGLE

When the first subscriber C subscribes to B:

1. `_output = sink` (C's sink function)
2. Connect to deps via `_lazyConnect()` — subscribe to each dep's `source()`
3. Handler closures fire on dep signals — `_cachedValue` and `_status` kept current

C receives a talkback. Calling `talkback(END)` removes C from the output slot.

### Mode 2: MULTI

When a second subscriber D subscribes while C is already in the slot:

1. `_output` switches from a single sink function to `Set{C, D}`
2. Emissions dispatch to all sinks in one pass
3. Additional subscribers just join the Set — no upstream restructuring
4. Each `talkback(END)` removes only that specific sink from the Set

**Key:** A never gets an additional subscriber. The only topology change is in the output slot. This is the decisive advantage: topology changes are O(1) and source-agnostic.

### Return to DISCONNECTED

When the last subscriber leaves:

- For both `derived` and `operator`: `_output = null`, disconnect from all deps, `_status = DISCONNECTED`

`_cachedValue` is retained — `get()` returns the last cached value (or performs a fresh pull-recompute for derived).

---

## 7. `.get()` Semantics

`.get()` returns a meaningful value at all times. When `_status` is DIRTY, `.get()` also communicates staleness — it does not silently return a stale value as if it were fresh.

| Status | `.get()` behavior |
|--------|-------------------|
| `SETTLED` | Return `_value` — definitely current |
| `RESOLVED` | Return `_value` — guaranteed unchanged from last SETTLED |
| `DIRTY` | Return `_value` alongside a staleness indicator (exact API TBD — see below) |
| `DISCONNECTED` | Pull-based recompute: call `_fn()` which reads deps via closure, write result to `_cachedValue`, return it |
| `COMPLETED` | Return `_value` — last value before terminal |
| `ERRORED` | **Throw** the stored error (derived/dynamicDerived); return `_value` (producer/operator — error stored separately in `_errorData`) |

**Honest DIRTY feedback** — when `_status === DIRTY`, a new value is in flight. Silently returning `_value` misleads callers. Options for the API shape:
- `inspect()` → `{ status, value }` for callers that need to distinguish fresh vs. stale
- `get()` returns `_value` as-is (compatible with existing usages); staleness queryable via `node._status`
- Future: `getLive()` forces a synchronous upstream pull to return the real-time value

The chosen approach is: `.get()` returns `_value` for compatibility; `_status` is always publicly readable; `Inspector.inspect()` surfaces both together. The full pull-propagation design for a `getLive()` is deferred.

**DISCONNECTED pull recompute** writes the result to `_cachedValue` so subsequent `get()` calls can return it. When a subscriber later arrives, `_lazyConnect()` establishes the push pipeline and `_cachedValue` is overwritten by incoming DATA.

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
  dirtyDeps &= ~(1 << depIndex); // clear bit if set; no-op if not (raw callbag case) (Comment: why clear bit if not set? I feel that we should always keep track of the input data for the dep even if it's not dirty so when bitmask is 0 we can recompute using this cache for that dep)
  if (dirtyDeps === 0) recompute(); // wait for all known-dirty deps
}
```

Values from raw callbag deps are captured by calling `dep.get()` inside `recompute()` — the dep's value is current even if no DIRTY was sent.

---

## 10. Lifecycle: Startup, Teardown, Cleanup, Reconnect

### Construction → Connection → Disconnection

1. **Construction** (once): Initialize properties, prepare handler closures, register with Inspector. Do NOT connect to deps — fully lazy.
2. **Connection** (first subscriber arrives): `_lazyConnect()` subscribes to each dep's `source()`. Handler-local state (counters, accumulators, flags) allocated fresh.
3. **Disconnection** (last subscriber leaves): `_output = null`, disconnect from all deps, `_status = DISCONNECTED`. `_cachedValue` retained for `get()` pull-recompute.

`beginDeferredStart()` / `endDeferredStart()` batches chain activations so a subscriber's baseline is captured before any producer emits.

### Completion/error teardown

Order: idempotency guard → set terminal status → store error (derived: `_cachedValue`; operator: `_errorData`) → disconnect upstream (`talkback(END)`) → null `_output` → `_stop()` cleanup → notify sinks with `END`/`END(error)`. Multi-sink: try/catch per sink. **Cleanup before notification** ensures `resubscribable` re-subscription finds clean state.

### D5: Error handling in derived/dynamicDerived

- **Push path**: try/catch around `fn()` → `_handleEnd(err)` sets ERRORED, stores error, disconnects upstream. Late subscriber to ERRORED node gets `START` + `END(error)`.
- **Pull path** (`get()` when disconnected): `fn()` throws directly to caller. No state mutation — retryable on next `get()`.
- **`get()` on ERRORED node**: throws the stored error.

### Reconnect

- **derived**: `_lazyConnect()` re-subscribes to deps on new subscriber.
- **operator**: `init()` re-runs, handler-local state resets.
- **producer**: `_start()` re-runs. If `resetOnTeardown`, `_value` resets.
- **effect**: no reconnect — dispose and create new.
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

See [`docs/optimizations.md`](optimizations.md) for the full optimization reference (V8 hidden classes, bitmask flags, SINGLE_DEP/P_SKIP_DIRTY signaling, handler closure zero-allocation, snapshot-free completion).

Key principles:
- Classes for hot paths (`ProducerImpl`, `DerivedImpl`, `OperatorImpl`) — all properties initialized in constructor for V8 hidden class stability.
- Booleans packed into `_flags: number` as bit flags.
- Handler closures capture `this`, write `_cachedValue`/`_status` in-place — zero allocation per signal.
- `effect` is a pure closure (no class).

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

Inspector hooks into handler closures (zero-cost when disabled). See `src/core/inspector.ts` for the full API.

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

## 17. Summary: Decision Tree for New Extras

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

---

## 19. Higher-Level Layers (Utils, Data, Memory, Orchestrate)

These layers build on core + extra. Read the source READMEs when working in these areas.

> **Design principle (§1.14):** High-level layers expose user-friendly APIs with domain semantics.
> If low-level callbag internals must be accessible, lump them under an `inner` property.
> Users of `pipeline()`, `formField()`, `chatStream()`, etc. should never need to understand
> DIRTY/RESOLVED or output slots.

### Utils (`src/utils/`)

Pure strategies and reactive utilities. Key categories:

- **Resilience:** `circuitBreaker`, `withBreaker`, `retry`, `backoff` (constant/linear/exponential/fibonacci/decorrelatedJitter)
- **Async/concurrency:** `asyncQueue`, `cancellableAction`, `cancellableStream`, `batchWriter`
- **Metadata wrappers:** `withStatus`, `track`, `tokenTracker`, `connectionHealth`
- **Eviction:** `eviction` (fifo/lru/lfu/scored/random), `reactiveEviction` (O(log n) min-heap with effect subscriptions)
- **State:** `dirtyTracker`, `stateMachine`, `timer` (countdown/stopwatch), `validationPipeline`
- **Persistence:** `checkpoint`, `checkpointAdapters` (file/SQLite/IndexedDB)
- **Graph:** `dag` (topological sort, acyclicity validation)

### Data (`src/data/`)

Reactive data structures using the **version-gated pattern**: `state<number>` version counter bumped on structural changes, `derived` stores materialize lazily. All implement `NodeV0` (`id`, `version`, `snapshot()`).

| Structure | Purpose |
|-----------|---------|
| `reactiveMap` | Key-value store with TTL, eviction, namespaces, keyspace events |
| `reactiveLog` | Append-only log with bounded circular buffer, sequence numbers |
| `reactiveIndex` | Secondary index (`indexKey → Set<primaryKey>`) with reverse map |
| `reactiveList` | Ordered collection with positional operations (index-based, version-gated) |
| `pubsub` | Topic-based pub/sub — lazy `state` per topic, `equals: () => false` |

### Memory (`src/memory/`)

`collection` uses `reactiveIndex` for O(1) tag-based lookups. `byTag(tag)` delegates to `_tagIndex.get(tag)`.

### Orchestrate (`src/orchestrate/`)

Workflow nodes — users build pipelines with these building blocks. All nodes expose workflow-friendly APIs. Low-level callbag internals (stream status, step metadata) live under `pipeline().inner`.

| Node | What it does |
|------|-------------|
| `pipeline(steps)` | Declares a DAG of steps. Auto-wires deps, tracks status, provides reset/destroy. `destroy()` tears down subscriptions and destroys auto-detected `task()` states (externally provided `opts.tasks` are left to the caller). Expert internals under `.inner` (streamStatus, stepMeta, topo order). |
| `task(deps, fn, opts)` | Value-level work step. Auto-join (combine), re-trigger (switchMap), lifecycle (taskState). **Default choice for work.** |
| `branch(dep, pred)` | Binary conditional routing. Creates `name` (pass) + `name.fail` (fail) steps. |
| `approval(dep, opts)` | Human-in-the-loop. Queues values until `approve()`/`reject()`/`modify()`. |
| `step(factory)` | Raw reactive source wrapper. For `fromTrigger()`, `state()`, or expert-only full reactive control. |
| `gate(opts)` | Pipe operator for approval queuing — the building block under `approval()`. Also usable standalone for custom human-in-the-loop flows. |
| `taskState(opts)` | Reactive task tracker with companion stores: `status`, `error`, `duration`, `runCount`, `result`, `lastRun`. Each companion is an independent `Store`. `.get()` returns composed `TaskMeta` for convenience. Used internally by `task()`, but also standalone. |
| `executionLog(opts)` | Reactive execution history with pipeline auto-logging. Backed by `reactiveLog`. |

## 20. Companion Store Pattern (`with*()` Wrappers)

`Store<T>` is pure: `get()`, `set()`, `source()`. It carries a value, nothing more. But
async/streaming sources (WebSocket, HTTP, LLM, pipelines) have lifecycle metadata — status,
errors, retry counts — that consumers need. The question is: where does that metadata live?

### Why not in the store

Putting metadata inside the value (`Store<{ value: T, status, error }>`) breaks composition.
Every operator in a pipe chain would need to understand the wrapper shape. `map`, `filter`,
`derived` — they all operate on `T`, not `{ value: T, … }`.

A separate `StreamStore<T>` type fails similarly. After `pipe(wsStore, map(x => x.data))`,
the result is a plain `Store` — the `StreamStore` type is lost at the first operator.
`derived`/`operator` can't propagate status because they don't know (or care) whether their
upstream is sync or async.

### Solution: companion stores as properties

`with*()` wrappers return `Store<T> & { companion: Store<…>, … }` — the original store,
extended with additional stores as properties. Each companion is itself a plain `Store`,
independently subscribable.

```ts
// withStatus — the base wrapper for all async/streaming sources
function withStatus<T>(store: Store<T>): Store<T> & {
  status: Store<'idle' | 'pending' | 'active' | 'completed' | 'errored'>
  error: Store<Error | undefined>
}

// Adapters use withStatus internally — return Store<T> with companions
fromWebSocket(url)  // → Store<T> & { status, error, connectionState, send(), close() }
fromHTTP(url)       // → Store<T> & { status, error, fetchCount, refetch(), stop() }
fromWebhook(opts)   // → Store<T> & { status, error, requestCount, handler, listen(), close() }
chatStream(opts)    // → Store<string> & { status, error, ... }

// fromLLM and fromMCP use WithStatusStatus enum for status stores
fromLLM(opts)       // → { store, status, error, tokens, generate(), abort() }
fromMCP(opts)       // → { tool() → { store, status, error, lastArgs, duration, call() } }

// Domain wrappers add their own companions
withRetry(store, config)   // → Store<T> & { retryCount, lastError, pending }
withBreaker(store, breaker) // → Store<T> & { breakerState }
```

**`WithStatusStatus` values:**

| Value | Meaning |
|-------|---------|
| `idle` | No work requested yet (used by MCP tools, manual lifecycle). |
| `pending` | Work has been initiated but no data received yet. Default for `withStatus()`. |
| `active` | First DATA received; stream is live. |
| `completed` | Terminal — END received cleanly. |
| `errored` | Terminal — END received with error. |

### Key rules

1. **`Store<T>` stays pure.** No metadata fields on the base type.
2. **`with*()`  returns `Store<T> & { … }`** — still assignable to `Store<T>`.
3. **Companions are plain `Store<T>`** — framework bindings (`useSubscribe(ws.status)`) work with no special casing.
4. **Operators don't propagate companions.** After `pipe(ws, map(...))`, the result is a plain `Store`. If you need the status, keep a reference to the source.
5. **Wrappers compose.** `withRetry(withStatus(raw))` accumulates companions from both.

### Framework bindings

Thin hooks that bridge `Store<T>` into framework reactivity. Because companions are plain
stores, no overloads or special types are needed.

```ts
// React
const data   = useSubscribe(ws)          // Store<T> → T
const status = useSubscribe(ws.status)   // Store<string> → string

// Vue
const data   = useSubscribe(ws)          // Store<T> → Ref<T>
const status = useSubscribe(ws.status)   // Store<string> → Ref<string>
```

`useStore(store)` is for writable stores (returns `[value, setter]` in React, `Ref<T>` in Vue).
`useSubscribe(store)` is for read-only subscriptions — any `Store<T>`, including companions.
