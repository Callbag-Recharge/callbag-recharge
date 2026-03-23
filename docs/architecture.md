# Architecture

> **Status:** Canonical design document. All core architecture is implemented and shipped.

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

15. **Control flows through the graph, not around it.** Lifecycle events (reset, cancel, pause, resume) must propagate as TYPE 3 STATE signals through the reactive graph — never as imperative method calls that bypass the topology. When control bypasses the graph: new node types silently escape supervision, composition breaks (child pipelines miss parent resets), and the signal model has a hole where control and data diverge. AbortSignal bridges STATE signals to imperative async (fetch, setTimeout) but is never the primary control mechanism. **Litmus test:** if adding a new orchestrate node requires registering it in a flat list for lifecycle management, the design is wrong — the graph should carry the signal.

16. **No raw `new Promise` — use callbag or library primitives.** Business logic must never create `Promise` objects directly. Async coordination (delays, waiting for state changes, bridging to `await`) must go through callbag-based primitives: `raw/fromTimer` for delays (pure callbag source, no core deps), `raw/firstValueFrom` for awaiting callbag sources, `extra/fromTimer` when a full `ProducerStore` is needed, `producer` for wrapping async sources. The ONE acceptable `new Promise` lives inside `firstValueFrom` (`raw/`) — the canonical callbag → Promise bridge. `raw/` is the foundation layer with zero core dependencies; it uses only the callbag protocol directly. Everything else composes on top.

17. **Push/pull via callbag, never poll.** When code needs to wait for a condition (e.g. "wait until unpaused"), use a reactive store + `firstValueFrom` so the waiter is notified by push. Do not use `setInterval`/`setTimeout` polling loops to check conditions. Polling is acceptable only at true system boundaries (e.g. checking a pull-based subscription for new messages where no push notification exists).

18. **No `queueMicrotask` / `setTimeout` for reactive coordination.** When one reactive update should trigger another (e.g. auto-transitioning a state machine on error, unsubscribing after a condition is met), use `effect` or `derived` — never schedule via `queueMicrotask`, `setTimeout`, or `Promise.resolve().then()`. Microtask scheduling breaks synchronous glitch-free guarantees, makes behavior timing-dependent, and bypasses the reactive graph. The only acceptable timer usage is at true system boundaries (e.g. simulating network latency in demos via `fromTimer`).

---

## 2. Folder & Dependency Hierarchy

> **This is the single source of truth for import rules.** All other docs reference here.
> Each folder's `README.md` is the source of truth for its **purpose** and which functions belong there.

`derived` and `operator` are separate files with converged internals.

```
src/
├── core/            ← foundation: 6 primitives + protocol + inspector + pipe + types + bitmask
├── raw/             ← pure callbag primitives (rawSubscribe, fromTimer, firstValueFrom) — no core deps, foundation layer
├── extra/           ← operators, sources, sinks (tier 1 + tier 2)
├── utils/           ← resilience, async, tracking, strategies (withStatus, withBreaker, retry, backoff, …)
├── data/            ← reactive data structures (reactiveMap, reactiveLog, reactiveIndex, reactiveList, pubsub)
├── orchestrate/     ← workflow nodes (pipeline, task, branch, approval, gate, taskState, executionLog)
├── messaging/       ← Pulsar-inspired topic/subscription system (topic, subscription, repeatPublish)
├── memory/          ← agent memory primitives (collection, decay, node)
├── patterns/        ← composed recipes (chatStream, formField, agentLoop, textEditor, pagination, …)
├── worker/          ← reactive cross-thread bridge (workerBridge, workerSelf, WorkerTransport)
├── adapters/        ← external system connectors (fromHTTP, fromWebSocket, fromLLM, fromMCP, …)
├── compat/          ← drop-in API wrappers + framework bindings (react, vue, signals, zustand, jotai, nanostores)
└── index.ts         ← public API barrel (core primitives only; other layers via subpath exports)
```

### Dependency tiers

The import hierarchy flows strictly downward. Each tier can import from its own level and below.

```
Tier -1 (raw callbag) raw/
                        ↓
Tier 0 (foundation)   core/
                        ↓
Tier 1 (operators)    extra/
                        ↓
Tier 2 (utilities)    utils/
                        ↓
Tier 3 (domains)      orchestrate/    messaging/    memory/    worker/
                        ↓                ↓              ↓          ↓
Tier 4 (surface)      patterns/    adapters/    compat/
```

`data/` is a **cross-cutting layer** — importable from any tier (core excluded).

`raw/` is the **foundation layer** — pure callbag protocol with zero core dependencies. Contains `rawSubscribe` (callbag sink), `fromTimer` (callbag source from setTimeout), and `firstValueFrom` (callbag → Promise bridge, the ONE place `new Promise` is allowed). `raw/` never imports from `core/` or any other folder. Importable from any tier.

### Strict import rules (the canonical reference)

- `raw/` never imports from any other folder — pure callbag protocol, zero dependencies
- `core/` imports from `raw/` only
- `extra/` imports from `core/` and `raw/` only
- `utils/` imports from `core/`, `raw/`, and `extra/` only
- `data/` imports from `core/`, `raw/`, and `utils/` only
- `orchestrate/` imports from `core/`, `raw/`, `extra/`, `utils/`, and `data/`
- `messaging/` imports from `core/`, `raw/`, `extra/`, `utils/`, `data/`, and `orchestrate/`
- `memory/` imports from `core/`, `raw/`, `utils/`, and `data/`
- `worker/` imports from `core/`, `raw/`, `extra/`, and `utils/`
- `patterns/` imports from `core/`, `raw/`, `extra/`, `utils/`, `data/`, `orchestrate/`, `messaging/`, `memory/`, and `worker/`
- `adapters/` imports from `core/`, `raw/`, `extra/`, `utils/`, `data/`, `orchestrate/`, `messaging/`, `memory/`, and `worker/`
- `compat/` imports from `core/`, `raw/`, `extra/`, `orchestrate/`, and `memory/` only
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

## 3. Protocol: Type Constants & Signal Vocabulary

```ts
const START = 0;   // Callbag handshake
const DATA  = 1;   // Real values only — never sentinels
const END   = 2;   // Completion (no payload) or error (payload = error)
const STATE = 3;   // Control signals: DIRTY, RESOLVED, lifecycle signals.

const DIRTY    = Symbol("DIRTY");     // "My value is about to change."
const RESOLVED = Symbol("RESOLVED"); // "I was dirty, value didn't change."

// Lifecycle signals — flow UPSTREAM via talkback (sink → source direction)
const RESET    = Symbol("RESET");    // Reset to initial state
const PAUSE    = Symbol("PAUSE");    // Pause activity (timers, polling)
const RESUME   = Symbol("RESUME");   // Resume after pause
const TEARDOWN = Symbol("TEARDOWN"); // Terminal — complete + cleanup
```

**Direction — the graph is a DAG:**
```
sources → transforms → sinks   (DOWNSTREAM: DATA, DIRTY, RESOLVED, END)
sources ← transforms ← sinks   (UPSTREAM: talkback(END), lifecycle signals via talkback(STATE, signal))
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

Every transform node B processes signals through inlined stages (not composed callbag functions):

```
dep.source → state tracking → transform(fn) → value caching → output dispatch
```

`_connectSingleDep()` and `_connectMultiDep()` contain all stages as inline closure logic.

- **State tracking:** STATE DIRTY → `_status = DIRTY`, forward. STATE RESOLVED → `_status = RESOLVED`, forward. Unknown STATE → forward unchanged. END → disconnect, forward.
- **Value caching:** DATA → `_cachedValue = computed`, `_status = SETTLED`, dispatch to output slot.
- **Always active:** Handler closure always writes `_cachedValue`/`_status` regardless of subscribers. `_dispatch()` no-ops when `_output === null`.

---

## 6. The Output Slot

Every node has an **output slot** (`_output`) — a lazy multicast dispatch point. Upstream nodes are unaware of topology changes.

```
DISCONNECTED (null) ──→ SINGLE (fn) ──→ MULTI (Set)
      ↑                      |                |
      └──[last unsub]────────┘                |
      └──[last unsub]─────────────────────────┘
```

- **DISCONNECTED:** `_output = null`, deps not connected. `get()` pull-computes from deps. Fully lazy.
- **SINGLE:** `_output = sink`. First subscriber triggers `_lazyConnect()`.
- **MULTI:** `_output = Set{sinks}`. Dispatch to all in one pass. O(1) topology changes.

On last unsubscribe: `_output = null`, disconnect from deps, `_status = DISCONNECTED`. `_cachedValue` retained for `get()`.

---

## 7. `.get()` Semantics

| Status | `.get()` behavior |
|--------|-------------------|
| `SETTLED` / `RESOLVED` | Return `_value` (current) |
| `DIRTY` | Return `_value` (may be stale); staleness queryable via `_status` or `Inspector.inspect()` |
| `DISCONNECTED` | Pull-recompute: call `_fn()`, write to `_cachedValue`, return it |
| `COMPLETED` | Return last value before terminal |
| `ERRORED` | **Throw** stored error (derived/dynamicDerived); return `_value` (producer/operator) |

---

## 8. Diamond Resolution

Multi-dep nodes use a `Bitmask` to track which deps are dirty. Recompute fires only when all bits clear.

- **DIRTY from dep N:** set bit N, forward DIRTY on first dirty dep only
- **RESOLVED from dep N:** clear bit N, forward RESOLVED if all clear
- **DATA from dep N:** clear bit N, recompute if all clear

`Bitmask` class: ≤32 deps → plain number; >32 deps → `Uint32Array` with O(1) `empty()`. Single-dep chains skip bitmask entirely.

**Diamond A→B,C→D:** A sets both bits. B's DATA clears bit 1, A's DATA clears bit 0. D computes exactly once with both values current. Order of DATA arrival doesn't matter.

---

## 9. Signal Handling Reference

### Direction

- **DIRTY, RESOLVED, DATA, END** → downstream (source → sink)
- **PAUSE, RESUME** → bidirectional (downstream via `signal()`, upstream via talkback)
- **talkback(END)** → upstream (unsubscribe)
- **talkback(STATE, lifecycleSignal)** → upstream (RESET, TEARDOWN)

### Lifecycle signals

Flow **upstream** via `talkback(STATE, signal)`. PAUSE/RESUME also propagate **downstream** (unknown STATE signals are forwarded per rule 6).

| Signal | Behavior |
|--------|----------|
| RESET | Reset `_value` to initial, re-init operator handler (generation counter invalidates stale closures), clear derived cache, re-run effect |
| PAUSE | Forward upstream; tier 2 extras handle locally (pause timers, polling) |
| RESUME | Forward upstream; resume paused activity |
| TEARDOWN | Handle cleanup, then `complete()` — cascades END downstream |

```ts
const sub = subscribe(store, (v) => console.log(v));
sub.signal(PAUSE);    // sends PAUSE upstream through the graph
sub.signal(RESET);    // resets all upstream state to initial
sub.signal(TEARDOWN); // terminates the graph
sub.unsubscribe();    // standard unsubscribe
```

**Single-owner semantics:** Multiple subscribers sending conflicting signals is undefined behavior.

**Tier 2 boundary:** DIRTY/RESOLVED don't cross tier 2 boundaries (producer-based operators like switchMap, debounce). Lifecycle signals DO cross via `onSignal` handlers. Tier 2 nodes start fresh DIRTY+DATA cycles via `autoDirty: true`.

**Raw callbag compat:** DATA without prior DIRTY is handled gracefully — bitmask `clear` is a no-op if bit wasn't set, and values are captured via `dep.get()` on recompute.

---

## 10. Lifecycle: Startup, Teardown, Cleanup, Reconnect

1. **Construction:** Initialize properties, register with Inspector. Do NOT connect to deps — fully lazy.
2. **Connection** (first subscriber): `_lazyConnect()` subscribes to deps. `beginDeferredStart()`/`endDeferredStart()` batches activations.
3. **Disconnection** (last unsubscribe): null `_output`, disconnect deps, `DISCONNECTED`. `_cachedValue` retained.

**Completion/error teardown order:** idempotency guard → terminal status → store error → disconnect upstream → null `_output` → `_stop()` cleanup → notify sinks. **Cleanup before notification** ensures `resubscribable` re-subscription finds clean state.

**Error handling (derived):** Push path: try/catch around `fn()` → ERRORED, disconnects upstream. Pull path (`get()` disconnected): throws directly to caller, retryable. `get()` on ERRORED: throws stored error.

**Reconnect:** derived re-subscribes via `_lazyConnect()`. Operator re-runs `init()`. Producer re-runs `_start()`. Effect: dispose and create new. Completed nodes reject new subscribers unless `resubscribable`.

---

## 11. Operator Implementation Rules

- **Guard order:** `if (completed) return` → STATE → DATA → END
- **Passthrough:** `signal(data)` for all STATE (no exceptions), `emit(transform(data))` for DATA, `data ? error(data) : complete()` for END
- **Suppress = RESOLVED:** Operators rejecting DATA (filter, distinctUntilChanged) MUST send `signal(RESOLVED)`. Silence leaves downstream bitmasks waiting forever.
- **Dynamic upstream = tier 2:** Use producer + subscribe. Operator deps are static.

---

## 12. Resource Cleanup

Every tier 2 extra must clean up all resources in `_stop()`: `clearInterval`, `clearTimeout`, `removeEventListener`, `unsub()`, `talkback(END)`, cancelled flags, `subscription.unsubscribe()`.

---

## 13. Behavioral Compatibility

**Default:** Match RxJS semantics for any operator with an RxJS equivalent.

**Key divergences:** Suppression emits RESOLVED (not silence) for bitmask clearing. `share()` is no-op (stores are multicast). Completion cleans up before notifying sinks (reentrancy safety). `batch()` defers DATA, not DIRTY.

**TC39 Signals:** `state` matches Signal.State: `equals: Object.is`, `set(same)` is no-op.

**Raw callbag:** Type 1 is pure values. Raw sources use "DATA without prior DIRTY" compat path (§9).

---

## 14. Optimization Guidelines

See [`docs/optimizations.md`](optimizations.md) for the full reference. Key principles: classes for hot paths (V8 hidden classes), booleans packed into `_flags`, handler closures write in-place (zero allocation), `effect` is a pure closure.

---

## 15. Inspector & Debugging

```ts
Inspector.inspect(store)  // { name, kind, value, status }
Inspector.graph()         // Map of all named stores
Inspector.getEdges()      // dependency graph
Inspector.snapshot()      // JSON-serializable { nodes, edges }
Inspector.toMermaid()     // diagram text
Inspector.observe(store)  // protocol-level test utility
```

Zero per-store cost via WeakMaps. Disable in production: `Inspector.enabled = false`.

---

## 16. Raw Callbag Interop

Raw callbag operators lack `source()` and multicast capability. The `wrap()` interop wrapper promotes them to proper nodes with output slots. Raw operators in diamonds swallow STATE signals, causing "DATA without prior DIRTY" compat path (§9). Raw callbag sinks need no wrapping.

---

## 17. Decision Tree for New Extras

1. **Sync transform, static deps?** → `operator()` (or `derived()` as sugar). Forward STATE, suppress with RESOLVED, bitmask for multi-dep.
2. **Async / timer / dynamic upstream?** → `producer()` with `autoDirty: true`. Subscribe internally, emit fresh cycles, return cleanup fn.
3. **Fused pipe?** → `pipeRaw()` for lazy, SKIP sentinel for filter semantics.
4. **Last resort** → raw callbag.

**Checklist for all extras:** cleanup on every exit path, error forwarding (`END(error)` → `error()`), RESOLVED on suppression, reconnect resets state, match RxJS semantics (§13), Inspector registration.

---

## 19. Higher-Level Layers

> **Design principle (§1.14):** High-level layers expose user-friendly APIs with domain semantics.
> Callbag internals go under `inner` property. Read source READMEs when working in these areas.

### Utils (`src/utils/`)

Resilience (`circuitBreaker`, `withBreaker`, `retry`, `backoff`), async (`asyncQueue`, `cancellableAction`), metadata (`withStatus`, `withConnectionStatus`, `track`), eviction (fifo/lru/lfu/scored), state (`stateMachine`, `timer`), persistence (`checkpoint` + file/SQLite/IndexedDB adapters), caching (`cascadingCache`, `tieredStorage`), graph (`dag`).

### Data (`src/data/`)

Reactive data structures using version-gated pattern. `reactiveMap` (KV + TTL + eviction), `reactiveLog` (append-only + circular buffer), `reactiveIndex` (dual-key + reverse map), `reactiveList` (positional ops), `pubsub` (lazy topic stores), `compaction` (log compaction).

### Messaging (`src/messaging/`)

Pulsar-inspired topic/subscription. `topic` (persistent stream), `subscription` (cursor-based consumer with exclusive/shared/failover/key_shared modes), `repeatPublish` (scheduled production), `jobQueue` (topic + subscription + processing), `jobFlow` (multi-queue chaining).

### Memory (`src/memory/`)

`collection` (reactive index for O(1) tag lookups), `decay` (time-based eviction), `node` (memory node with metadata).

### Worker (`src/worker/`)

Reactive cross-thread bridge. `workerBridge()`/`workerSelf()` expose/import stores across Worker/SharedWorker/ServiceWorker/BroadcastChannel. Lifecycle signals serialize across wire. Batch coalescing via reactive graph.

### Orchestrate (`src/orchestrate/`)

`pipeline(steps)` (DAG builder), `task(deps, fn)` (work step — signal-first callbacks), `branch` (conditional routing), `approval` (human-in-the-loop), `gate` (approval building block), `taskState` (reactive tracker with companion stores), `forEach` (fan-out), `onFailure` (dead letter), `wait`, `subPipeline`, `join` (merge strategies), `sensor`, `loop`, `executionLog`, `pipelineRunner`, `toMermaid`/`toD2`.

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
fromLLM(opts)       // → Store<string> & { status, error, tokens, generate(), abort() }
fromMCP(opts)       // → { tool() → Store<T> & { status, error, lastArgs, duration, call() } }

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
