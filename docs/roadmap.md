# Roadmap

> **Vision:** 川流不息，唯取一瓢 — "State that flows."

---

## What's Shipped

155 modules across 11 categories. Full inventory in `src/archive/docs/roadmap-v0.4.0-shipped.md`.

| Category | Count | Highlights |
|----------|------:|------------|
| Core | 6 | `producer`, `state`, `derived`, `dynamicDerived`, `operator`, `effect` + protocol, inspector, pipe, bitmask |
| Extra | 65 | Operators (`map`, `filter`, `switchMap`, `exhaustMap`, …), sources (`fromPromise`, `fromCron`, `fromEvent`, …), sinks (`subscribe`, `forEach`) |
| Utils | 28 | `retry`, `withBreaker`, `withStatus`, `withConnectionStatus`, `withSchema`, `checkpoint` + 3 adapters (file/SQLite/IndexedDB), `track`, `dag`, `backoff`, `circuitBreaker`, `rateLimiter`, `tokenTracker`, `priorityQueue`, `namespace`, `transaction`, `tieredStorage`, … |
| Data | 6 | `reactiveMap`, `reactiveLog`, `reactiveIndex`, `reactiveList`, `pubsub`, `compaction` |
| Messaging | 3 | `topic`, `subscription`, `repeatPublish` — Pulsar-inspired topic/subscription system |
| Memory | 3 | `collection`, `decay`, `node` |
| Orchestrate | 13 | `pipeline`, `task`, `branch`, `approval`, `gate`, `taskState`, `executionLog`, `join`, `toMermaid`, `toD2`, `pipelineRunner`, `sensor`, `loop` |
| Patterns | 15 | `agentLoop`, `chatStream`, `textEditor`, `formField`, `undoRedo`, `pagination`, `commandBus`, … |
| Adapters | 6 | `fromHTTP`, `fromLLM`, `fromMCP`, `toSSE`, `fromWebhook`, `fromWebSocket`/`toWebSocket` |
| Worker | 5 | `workerBridge`, `workerSelf`, `createTransport`, `WorkerTransport`, wire protocol |
| Compat | 8 | Jotai, Nanostores, TC39 Signals, Zustand, Vue (`useStore`/`useSubscribe`), React (`useStore`/`useSubscribe`), Svelte (`useSubscribe`), Solid (`useSubscribe`) |

---

## In Progress

(Nothing currently in progress.)

---

## What's Shipped (recent)

### Phase 5a-0: §1.14 Compliance Pass

> **Goal:** Audit and fix all high-level modules for §1.14 compliance — no callbag protocol
> leakage in public APIs of orchestrate/, patterns/, adapters/, compat/.
>
> **Status:** Complete.

| # | Deliverable | What | Status |
|---|-------------|------|--------|
| ~~5a-0.1~~ | ~~`taskState` inner isolation~~ | `taskState.source` hidden behind `inner` property (`Store<TaskMeta>`). Pipeline subscribes to `inner` stores via `derived()`. | ~~S~~ |
| ~~5a-0.2~~ | ~~`task._taskState` encapsulation~~ | `_taskState` replaced with `Symbol.for("callbag-recharge:taskState")` key. Exported as `TASK_STATE`. | ~~S~~ |
| ~~5a-0.3~~ | ~~JSDoc sanitization~~ | "DIRTY+value cycle" → "reactive update cycle", "sends END" → "terminates the store", "RESOLVED signals" → "suppression signaling", "callbag DATA/END" → "stream lifecycle events". Applied to gate, branch, pipeline, http, websocket, webhook, createStore. | ~~S~~ |
| ~~5a-0.4~~ | ~~`batch()` audit~~ | `batch()` wraps multi-store transitions in taskState (run success/error/reset), fromHTTP (fetchCount+status), fromLLM (generate reset), fromMCP (tool call start/complete/error). | ~~S~~ |

### Phase 5a: Uniform Metadata Pattern

> **Goal:** Standardize all status/error/lifecycle metadata on the companion store pattern (§20).
>
> **Status:** Complete.

| # | Deliverable | What | Status |
|---|-------------|------|--------|
| ~~5a-1~~ | ~~`taskState` companion refactor~~ | `taskState` exposes `status`, `error`, `duration`, `runCount`, `result`, `lastRun` as individual companion `Store` properties. `inner` removed. `get()` returns composed `TaskMeta` for convenience/snapshot. | ~~S~~ |
| ~~5a-2~~ | ~~`task()` flat companions~~ | `TaskStepDef` exposes `status`, `error`, `duration`, `runCount` as flat properties delegating to internal `taskState`. `TASK_STATE` symbol kept internal. Pipeline auto-detection unchanged. | ~~S~~ |
| ~~5a-3~~ | ~~Adapter `withStatus` reuse~~ | `fromHTTP`, `fromWebSocket`, `fromWebhook` use `withStatus()` for lifecycle tracking. `fromLLM` and `fromMCP` standardized to `WithStatusStatus` enum. Domain-specific `HTTPStatus`, `WebSocketStatus`, `MCPToolStatus` types removed. WebSocket adds `connectionState` companion. Adapter return types extend `Store<T>` (no separate `.store` property). | ~~S~~ |

### Phase 5d: Cross-Cutting Infrastructure

> **Goal:** Generic primitives that benefit messaging, orchestration, and agentic memory equally.
> These live in `utils/` and `data/` (tiers 2 and cross-cutting) so all higher layers can use them
> without circular dependencies.
>
> **Status:** Complete.

| # | Deliverable | Where | What | Status |
|---|-------------|-------|------|--------|
| ~~5d-1~~ | ~~`PriorityQueue<T>`~~ | `utils/` | Array-backed binary min-heap with comparator. O(log n) insert/extract-min. `peek()`, `poll()`, `size`, `drain()`. Non-reactive internal data structure. | ~~S~~ |
| ~~5d-2~~ | ~~`withSchema`~~ | `utils/` | `withSchema<T>(store, schema)` — runtime validation wrapper. Accepts `{ parse(v: unknown): T }` (Zod/Valibot/ArkType). Error companion store. Validated `set()` with read-only guard. Fail-fast on invalid initial value. | ~~S~~ |
| ~~5d-3~~ | ~~`namespace`~~ | `utils/` | `namespace(name)` — scoped naming + isolation. `ns.prefix("orders")` → `"tenant-a/orders"`. `ns.checkpoint(adapter)` → prefixed keys. `ns.child(sub)` for nesting. | ~~S~~ |
| ~~5d-4~~ | ~~`transaction`~~ | `utils/` | `transaction(stores, fn)` — atomic multi-store writes with rollback. Extends `batch()`: captures snapshots, rolls back on throw. Shallow snapshot (assumes immutable update patterns). | ~~S~~ |
| ~~5d-5~~ | ~~`compaction`~~ | `data/` | `compaction(log, keyFn, opts?)` — composable log compaction. Retains latest entry per key. Manual + auto-triggered (threshold). Reentrancy-safe. | ~~S~~ |
| ~~5d-6~~ | ~~`tieredStorage`~~ | `utils/` | `tieredStorage(hot, cold, opts?)` — two-tier `CheckpointAdapter` composition. Hot-first reads, cold fallback, auto-promote on cold hit. Pluggable eviction policy (LRU default, FIFO). `promote()`/`demote()` for manual tier migration. | ~~S~~ |

---

## Backlog

### Phase 5b: Orchestration — Production Parity

> **Goal:** Close the gaps that prevent `pipeline()` from replacing n8n/Airflow in real
> workflows. Persistence, batch processing, request-response webhooks, error routing.
>
> **Depends on:** Orchestrate + checkpoint adapters (shipped).

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| ~~5b-1~~ | ~~Persistent execution log adapters~~ | `fileLogAdapter` (JSONL, asyncQueue-serialized), `sqliteLogAdapter`, `indexedDBLogAdapter` for `executionLog()`. Same pattern as `checkpointAdapters`. IndexedDB adapters (both checkpoint + log) now retry once on stale connection after `onversionchange`. | ~~S~~ |
| ~~5b-2~~ | ~~`forEach` step (fan-out)~~ | `forEach(dep, fn)` — single dep, spawns N parallel task instances from an array. Concurrency control, per-item fallback, switchMap re-trigger cancellation. Uses `taskState.restart()` to preserve cumulative `runCount` across re-triggers. | ~~M~~ |
| ~~5b-3~~ | ~~Webhook response wiring~~ | `fromWebhook()` emits `WebhookRequest<T>` with `body` + `respond(data, statusCode?)`. Auto-504 on timeout (default 30s). Timer cleanup on `close()`. No fire-and-forget mode — always request-response. | ~~M~~ |
| ~~5b-4~~ | ~~`onFailure` step / dead letter~~ | `onFailure(dep, handler)` — watches upstream task's error companion store (auto-registered as `"stepName.error"` compound dep). Fires handler on terminal failure. Has own `taskState` for tracking handler execution. | ~~M~~ |
| ~~5b-5~~ | ~~`wait` node~~ | `wait(dep, ms \| signal)` — duration mode (setTimeout) or signal mode (waits for truthy store emission). switchMap re-trigger cancellation. No taskState — pure passthrough delay. | ~~S~~ |
| ~~5b-6~~ | ~~`subPipeline` step~~ | `subPipeline(deps, factory)` — creates fresh child `pipeline()` per trigger, subscribes to child status, emits output step value, destroys child on re-trigger/parent destroy. Has own `taskState`. | ~~M~~ |
| ~~5b-7~~ | ~~`join` step (merge strategies)~~ | `join(deps, strategy)` — append, merge-by-key (`{ merge: keyFn }`), intersect (`{ intersect: keyFn }`). Full outer join and inner join semantics. Has own `taskState`, `_kind` discriminator for diagram detection, error tracking for non-array inputs. | ~~M~~ |
| ~~5b-8~~ | ~~`toMermaid` / `toD2` export~~ | `toMermaid(steps, opts?)` and `toD2(steps, opts?)` — serialize pipeline step-level DAG to diagram syntax. Step type auto-detection via `_kind` discriminator + `TASK_STATE` + `_failStore`. Optional runtime status decoration from `PipelineResult`. Branch `.fail` companion auto-included. | ~~S~~ |
| ~~5b-9~~ | ~~Pipeline runner~~ | `pipelineRunner(configs[])` — supervisor for long-running pipelines: health checks via periodic probes, auto-restart with pluggable backoff (exponential default), per-pipeline `Store<PipelineResult | null>` for reactive instance tracking, aggregate `RunnerStatus` (running/degraded/stopped). Manual `start`/`stop`/`restart` per-pipeline. | ~~S~~ |
| ~~5b-10~~ | ~~`sensor` step~~ | `sensor(dep, poll, opts?)` — Airflow sensor pattern. Poll external condition at interval until truthy, then forward upstream value. Has own `taskState`, timeout support, `_kind: "sensor"` for diagram detection. | ~~S~~ |
| ~~5b-11~~ | ~~`loop` step~~ | `loop(deps, factory, opts?)` — declarative iteration in pipeline builder. Fresh child pipeline per iteration, feeds output to next iteration. Predicate receives `(value, iteration)`. `maxIterations` safety valve (default 100). Has own `taskState`, `_kind: "loop"` for diagram detection. | ~~M~~ |

### Phase 5c: `with*()` Wrappers & Framework Bindings

> **Goal:** Formalize the `with*()` companion-store pattern so all async/streaming sources expose
> consistent metadata (status, error). Then build framework bindings that bridge any `Store<T>` —
> including companion stores — into Vue/React/Svelte/Solid.
>
> **Design:** `Store<T>` stays pure (just `get`/`set`/`source`). `with*()` wrappers return
> `Store<T> & { status: Store<…>, error: Store<…>, … }` — still a `Store<T>`, but with extra
> companion stores as properties. Adapters (`fromWebSocket`, `fromHTTP`, `chatStream`, etc.) use
> `withStatus()` internally so all async sources share a consistent API. Companions are themselves
> plain `Store<T>`, so framework bindings (`useSubscribe(ws.status)`) work with no special casing.

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| ~~5c-0~~ | ~~`withStatus` wrapper~~ | ~~Shipped.~~ `withStatus(store)` → `Store<T> & { status, error }`. Producer-backed with proper teardown. | ~~S~~ |
| ~~5c-1~~ | ~~Vue binding~~ | ~~Shipped.~~ `useStore(store)` → writable `Ref<T>`, `useSubscribe(store)` → readonly `Ref<T>`. `onScopeDispose` cleanup. | ~~S~~ |
| ~~5c-2~~ | ~~React binding~~ | ~~Shipped.~~ `useStore(store)` → `[value, set]`, `useSubscribe(store)` → `value`. Via `useSyncExternalStore` + core `subscribe()`. | ~~S~~ |
| ~~5c-3~~ | ~~Svelte binding~~ | ~~Shipped.~~ `useSubscribe(store)` → Svelte readable store (implements Svelte store contract). | ~~S~~ |
| ~~5c-4~~ | ~~Solid binding~~ | ~~Shipped.~~ `useSubscribe(store)` → Solid signal. Via `createSignal` + `onCleanup`. | ~~S~~ |

**Naming:** `useStore()` for writable stores (read + set). `useSubscribe()` for read-only
subscriptions — any `Store<T>`, including companions like `ws.status`. The name signals that
it creates a sink that activates the upstream chain. See architecture §20 for full design.

**Build order:** 5c-0 first (formalizes the pattern adapters already follow), then 5c-1 (Vue, for
our demos), then 5c-2 (React, largest audience). 5c-3/5c-4 as community demand arises.

Existing `with*()` wrappers (`withBreaker`, `withRetry`) already follow this shape — they return
`Store<T>` extended with domain-specific companion stores. 5c-0 just adds the base `withStatus`
and makes the convention explicit.

### Demo Suite

> **Goal:** Demos are the ground truth — if the demo works, the feature works.
> Two tiers: **showcase apps** (polished, no source panel — the "wow" demos) and
> **code examples** (with source, for builders to reference — replaces stale `src/examples/`).
>
> **Pattern:** `site/.vitepress/theme/components/<Name>/store.ts` (pure library code) +
> `<Name>.vue` (Vue reactivity via `useStore()` from 5c-1). No mocks — real library execution.

#### Showcase Apps (homepage heroes)

Full-featured apps. Users interact with them as products — no code panel, no "primitives used"
legend. The point is "look what you can build", not "look at our API".

| # | App | What the user experiences |
|---|-----|--------------------------|
| H1 | **Markdown Editor** | Split-pane: CodeMirror left, live Markdown preview right. Toolbar with undo/redo, word count, cursor position, auto-save dot. Feels like a real editor. |
| H2 | **AI Chat (WebLLM)** | Chat UI running a model in-browser via WebGPU (no API key). Three workers: Web Worker (WebLLM inference, token streaming), SharedWorker (cross-tab memory — summarization + IndexedDB, via `workerBridge`), Service Worker (model weight caching). Tokens stream in real-time, cancel mid-response, retry, token usage meter, rolling conversation summary. Depends on 5g (worker bridge). Feels like ChatGPT lite. |
| H3 | **Workflow Builder** | Code-first n8n. Left: CodeMirror editor with `pipeline()` code. Right: live DAG (Vue Flow). Press "Update" → code parses into a visual graph. Fire triggers, watch nodes animate, inspect logs, execution history persists to IndexedDB. Feels like a workflow tool. |

**Build order:** H1 → H2 → H3 (each builds on confidence from the last; H3 may depend on 5b-1)

#### Code Examples (doc pages)

Interactive demos with visible source. Embedded in API/pattern doc pages so builders can see
exactly how to use each primitive. These replace `src/examples/` as the canonical reference.

| # | Example | What it teaches |
|---|---------|-----------------|
| D1 | **Airflow Pipeline** (shipped) | `pipeline` + `step` + `taskState` wiring, diamond resolution |
| D2 | **Form Builder** | `formField` pattern, sync + async validation, derived aggregation |
| D3 | **Agent Loop** | `agentLoop` + `gate` + `approval`, tool call cycle |
| D4 | **Real-time Dashboard** | `reactiveMap` + `reactiveLog`, live aggregation, sampling |
| D5 | **State Machine Visualizer** | `stateMachine` util, typed transitions, graph rendering |
| D6 | **Compat Comparison** | Same counter/todo in callbag-recharge vs Jotai vs Zustand vs Signals |

### Phase 5d-follow: Compaction Event Type

> **Goal:** Add `"compact"` to `LogEventType` so subscribers can distinguish compaction-generated
> events from user-initiated appends. Decide after 5e when real consumption patterns are clear.
>
> **Depends on:** 5d-5 (shipped), 5e (topic uses compaction).
> **Trigger:** When implementing 5e-1 (topic) — if topic subscribers need to filter compaction events,
> add `"compact"` to `LogEventType` and emit it from `compaction.compact()` instead of
> synthetic clear+append events.

### Phase 5e: Messaging — Pulsar-Inspired Topic System

> **Goal:** Embeddable messaging layer modeled after Apache Pulsar's topic/subscription
> architecture. Topics are persistent streams with cursor-based consumption. A message queue
> is the foundation; a job queue is a thin wrapper that adds processing semantics on top.
>
> **Why Pulsar over RabbitMQ:** Pulsar's model (topic = append-only stream, subscription =
> cursor on that stream) maps directly to callbag-recharge's stream primitives. Sources emit,
> subscribers consume at their own pace, the source doesn't care about consumer state. RabbitMQ's
> consume-and-delete model is fundamentally at odds with reactive streams.
>
> **Key mapping:**
> - Pulsar topic → `reactiveLog` (append-only, sequence numbers, bounded)
> - Pulsar subscription → cursor + callbag `subscribe()` with backpressure
> - Pulsar Functions → `operator` / `task`
> - Subscription modes → dispatch strategies (exclusive, shared, failover, key_shared)
>
> **Depends on:** Phase 5d (cross-cutting infra), orchestrate (shipped), data (shipped).
>
> **Non-goals:** CRDTs, distributed locks, broker-free competing consumers. Distribution
> defers to Phase 7 adapters — the external broker (Redis, NATS) owns atomic dispatch for
> cross-process shared subscriptions. Saga pattern (pipeline + checkpoint + onFailure)
> handles failure recovery.

#### Layer 1: Message Queue (topic + subscriptions)

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| 5e-1 | `topic` | **Shipped.** `topic<T>(name, opts?)` — persistent append-only stream. Backed by `reactiveLog` (sequence numbers, bounded buffer). `publish(msg, opts?)` with optional priority, delay, dedup key, and schema validation. Supports `compaction` mode. Namespaced via `namespace`. Companion stores: `depth`, `latest`, `publishCount`. | M |
| 5e-2 | `subscription` | **Shipped.** `subscription(topic, opts)` — cursor-based consumer on a topic. Tracks position with persistent cursor state. Subscription modes: **exclusive**, **shared** (round-robin), **failover** (hot standby), **key_shared** (partition by key hash). Pull-based backpressure via `pull(count)`. `ack()` / `nack()` per message. Companion stores: `position`, `backlog`, `pending`. | M |
| 5e-3 | Topic lifecycle | **Shipped.** `pause()`/`resume()`, `seek(position)` (cursor rewind/fast-forward), `peek()`. Companion stores: `depth`, `backlog`, `pending`. | S |
| 5e-4 | Retry + dead letter topics | **Shipped.** `nack()` routes to retry queue with configurable backoff (`exponential`/`linear`/custom). Terminal failures route to dead letter topic with original headers preserved. | S |
| 5e-5 | Repeatable producers | **Shipped.** `repeatPublish(topic, valueOrFactory, opts)` — scheduled message production via interval or cron. Dedup by repeat key. Reactive `count` store. | S |

#### Layer 2: Job Queue (processing on top of topics)

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| 5e-6 | `jobQueue` | **Shipped.** `jobQueue<T>(name, processor, opts?)` — wraps a `topic` + `subscription(shared)` + per-job processing. Each message becomes a job with per-job `AbortController`. `add(data, opts?)` publishes to the underlying topic. Concurrency control via semaphore. Retry with configurable backoff, DLQ routing for terminal failures. | M |
| 5e-7 | Job events + monitoring | **Shipped.** `on('completed' \| 'failed' \| 'stalled', fn)` — event subscriptions with unsubscribe. Stall detection via configurable ack timeout + periodic polling. `stalledJobAction`: `"none"` (event only), `"cancel"` (abort + fail), `"retry"` (abort + re-enqueue). Aggregate companion stores: `active`, `completed`, `failed`, `waiting` counts. | S |
| 5e-8 | Multi-queue workflows | **Shipped.** `jobFlow(queues, edges, opts?)` — chains job queues via completion event wiring. Output of queue A publishes to queue B's topic. Optional transform per edge. Diagram export via `toMermaid()`/`toD2()`. Flow owns edges only; queue lifecycle managed by caller. | M |

**Distribution story (Phase 7 dependency):**
Once Redis/NATS adapters ship, topics gain cross-process capabilities with zero architecture
changes:
- **Shared subscriptions across processes:** External broker (Redis `BRPOPLPUSH`, NATS queue
  groups) replaces in-process round-robin. The subscription mode stays `shared` — only the
  dispatch backend swaps.
- **Distributed dead letter:** DLQ topic backed by `toRedis`/`toNats` sink for centralized
  failure handling.
- **Cross-process monitoring:** Companion stores bridge via adapter for centralized dashboards.
- **Geo-replication (future):** Topic replication across regions via adapter-to-adapter
  forwarding. Cursor positions sync independently per region.

### Phase 5f: Protocol-Native Lifecycle Signals

> **Goal:** Move lifecycle control (reset, cancel, pause/resume) from imperative method calls
> to TYPE 3 STATE channel signals. Currently, `pipeline.reset()` iterates a flat task list and
> calls `ts.reset()` on each — the callbag graph has no knowledge of reset. This phase makes
> lifecycle events first-class protocol signals that cascade through the graph topology.
>
> **Anti-pattern being fixed:** Imperative control bypassing the reactive graph. When lifecycle
> events don't flow through the protocol, new node types must be manually registered in
> supervisor lists, composition breaks (subPipeline doesn't naturally receive parent resets),
> and the signal model has a hole where control and data diverge.
>
> **Depends on:** Phase 5b (orchestrate shipped), Phase 5d (cross-cutting shipped).
>
> **Design constraint:** AbortSignal stays for canceling imperative async work (fetch, setTimeout)
> that lives outside the reactive graph. STATE signals trigger the abort; AbortSignal bridges
> to the imperative world. They're complementary, not competing.

| # | Deliverable | What | Effort | Status |
|---|-------------|------|--------|--------|
| 5f-1 | `RESET` STATE signal | Added `RESET`, `PAUSE`, `RESUME`, `TEARDOWN` symbols to protocol.ts. Signals flow upstream via talkback. `subscribe()` returns `Subscription` with `signal()` method. `isLifecycleSignal()` helper. `onSignal` added to `ProducerFn` actions. | S | **Done** |
| 5f-2 | `PAUSE` / `RESUME` signals | Added to STATE channel. All core nodes forward upstream. Tier 2 extras register `onSignal` handlers. | S | **Done** |
| 5f-3 | Core node RESET handling | All 6 core nodes handle lifecycle signals: producer resets `_value` + emits initial, operator uses generation counter + re-inits handler, derived clears cache, effect uses generation counter + re-runs, state resets to initial. TEARDOWN completes each node. | M | **Done** |
| 5f-4 | Timer utils signal migration | `countdown`/`stopwatch` fully rewritten as signal-based. Auto-start on first subscription. No imperative methods — controlled entirely via `sub.signal(PAUSE/RESUME/RESET)`. | S | **Done** |
| 5f-5 | Memory layer signal migration | `collection.destroy()` disposes tag-tracking effects, then tears down `_version` store (cascades END to `_nodesStore`, `_sizeStore`, and external subscribers). Tag effects depend only on `node.meta` (not `_version`) to avoid O(N) spurious re-runs on structural changes. | S | **Done** |
| 5f-6 | Orchestrate RESET migration | `pipeline.reset()` sends RESET via step subscriptions. `pipeline.destroy()` sends TEARDOWN. `task()` wraps output in operator interceptor that catches RESET→ts.reset(), TEARDOWN→ts.destroy(). No flat task list iteration. | M | **Done** |
| 5f-7 | Orchestrate flat-registry cleanup | `join` and `onFailure` wrapped with lifecycle signal interceptor operator (RESET→ts.reset(), TEARDOWN→ts.destroy()). `pipelineRunner.destroy()` uses `teardown()` on companion stores. `executionLog.destroy()` disconnects active `connectPipeline()` subscriptions; `connectPipeline()` cleanup tracked for proper lifecycle. | M | **Done** |
| 5f-8 | Adapter lifecycle signal migration | `fromHTTP`, `fromWebSocket`, `fromWebhook` all register `onSignal` handlers for PAUSE/RESUME/RESET. HTTP: pauses polling on PAUSE, cancels in-flight + restarts on RESET. WebSocket: pauses message processing. Webhook: pauses delivery. | S | **Done** |
| 5f-9 | Patterns layer signal migration | `memoryStore.destroy()` tears down `_sessionVersion` store after collection cleanup. `commandBus.dispose()` calls `teardown()` on undoStack/redoStack/lastCommand stores (cascades END to canUndo/canRedo derived). `focusManager`: `_ids` migrated from mutable array to `state` store; `dispose()` calls `teardown()` on activeStore and _idsStore (cascades END to hasFocus and isFocused derived stores). | M | **Done** |
| 5f-10 | Compat `SignalWatcher` flat registry | `SignalWatcher` stores `Subscription` objects (not bare closures). `unwatch()` calls `sub.unsubscribe()` to disconnect without destroying watched stores. New `destroy()` method disconnects all watchers in one pass. `onEnd` auto-cleanup removes entries when a watched store completes independently. (Inspector and Jotai compat WeakRef registries are acceptable by design.) | S | **Done** |
| 5f-11 | Lifecycle signal tests + docs | Test suite covering: RESET through derived/operator chains, state reset, effect re-run, tier 2 crossing (switchMap), TEARDOWN cascading, PAUSE/RESUME forwarding, timer signal control, diamond topology, isLifecycleSignal utility. architecture.md updated with lifecycle signal reference. | S | **Done** |

### Phase 6: Deep Memory

> **Goal:** Reactive agentic memory — vector search, knowledge graphs, memory lifecycle.
>
> **Depends on:** Data structures (shipped), memoryNode/collection/decay (shipped).

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| 6a | Session transport adapters | WebSocket sink, HTTP sink. Same graph, different edge. | M |
| 6b | In-process vector index | HNSW-based semantic search. ~1-10 μs vs Redis ~50-500 μs. | L |
| 6c | Knowledge graph (reactive) | Entity relationships with temporal tracking. Graph-based retrieval. | XL |
| 6d | Consolidation + self-editing | Memory lifecycle: dedup, summarize, forget. Admission control. | L |

### Phase 7: More Adapters

> **Goal:** Connect any external system with thin (~20-50 line) adapters.
>
> **Depends on:** Adapter pattern (shipped).

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| 7a | Redis adapter | `fromRedis(sub, channel)` / `toRedis(pub, channel)`. Peer dep: ioredis. | S |
| 7b | PostgreSQL adapter | `fromPgNotify(pool, channel)`. Peer dep: pg. | S |
| 7c | Kafka adapter | `fromKafka(consumer, topic)` / `toKafka(producer, topic)`. Peer dep: kafkajs. | M |
| 7d | gRPC stream adapter | `fromGrpcStream(call)` / `toGrpcStream(call)`. Peer dep: @grpc/grpc-js. | M |
| 7e | NATS adapter | `fromNats(nc, subject)` / `toNats(nc, subject)`. Peer dep: nats. | S |

### Phase 7.5: Pre-Launch Positioning

> **Goal:** Establish callbag-recharge's market position before v1.0 publish. Build the
> artifacts that drive organic discovery and the "reuse flywheel."
>
> **Depends on:** Demo suite (at least H1 + D1), Phase 5c (framework bindings shipped).
>
> **Informed by:** Gemini marketing research (March 2026) — competitor landscape analysis,
> agentic AI trust gap, streaming durability crisis, signals-vs-streams positioning.

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| 7.5-1 | Killer README | "State that flows" tagline, 10-line example, comparison table (vs Zustand/Jotai/Signals/LangGraph), bundle size, Inspector screenshot. | S |
| 7.5-2 | `llms.txt` | Machine-readable library summary at repo/site root for AI agent discovery. | S |
| 7.5-3 | Positioning blog posts | Top 3 from blog-strategy §Market-Positioning: "Missing Middle" (#10), "Durable Reactive Streams" (#11), "Trust Bottleneck" (#12). | M |
| 7.5-4 | npm publish prep | Keywords (reactive, state, signals, callbag, orchestration, agentic, durable), description, package.json metadata audit. | S |
| 7.5-5 | Community launch | HN Show, Reddit r/javascript + r/typescript + r/AI_Agents, dev.to cross-post. | S |

### Phase 5g: Worker Bridge — Reactive Cross-Thread Communication

> **Goal:** Abstract Web Workers, SharedWorkers, Service Workers, and BroadcastChannel behind
> a unified reactive store bridge. Stores exposed from one thread appear as reactive `Store<T>`
> on the other — no `postMessage`, no message IDs, no switch statements.
>
> **Key insight:** The worker channel is inherently a stream, yet the dominant abstraction
> (Comlink/RPC) models it as isolated request/response. Callbag stores embrace the streaming
> nature. Only settled values cross the wire; DIRTY/RESOLVED stays local to each side's graph.
>
> **Depends on:** Core (shipped), utils/withStatus (shipped), Phase 5f lifecycle signals (shipped).
>
> **Design:** [SESSION-worker-bridge-h2-design.md](../src/archive/docs/SESSION-worker-bridge-h2-design.md)
>
> **Status:** Complete.

| # | Deliverable | What | Effort | Status |
|---|-------------|------|--------|--------|
| ~~5g-1~~ | ~~`WorkerTransport`~~ | Internal transport abstraction — auto-detects Worker, SharedWorker, ServiceWorker, BroadcastChannel, MessagePort. Normalizes `post()`/`listen()`/`terminate()`. Also accepts pre-built `WorkerTransport` for testing. | S | **Done** |
| ~~5g-2~~ | ~~`workerBridge()` + `workerSelf()`~~ | Main-thread and worker-side APIs. `expose` sends store values across; `import` creates proxy `Store<T>` for received values. Batch coalescing via `derived()` + `effect()` — two-phase push + bitmask naturally coalesces `batch()` updates into one `postMessage`. TypeScript inference from `expose`/`import` declarations. | M | **Done** |
| ~~5g-3~~ | ~~Lifecycle signals across bridge~~ | PAUSE/RESET/RESUME/TEARDOWN serialize as strings across the wire (Symbols can't survive structured clone). `destroy()` sends TEARDOWN + calls `worker.terminate()`. Bridge-level TEARDOWN (`s: "*"`) destroys the entire remote side. | S | **Done** |
| ~~5g-4~~ | ~~`withConnectionStatus()` + transfer support~~ | New `withConnectionStatus()` utility in `utils/` — imperative connection lifecycle companions (`connecting` → `connected` → `disconnected` \| `failed`). Bridge uses it for status/error. `transfer` option per store for zero-copy `ArrayBuffer` passing. | S | **Done** |
| ~~5g-5~~ | ~~Tests~~ | 27 tests: wire protocol round-trip, handshake (both directions), multi-store sync, batch coalescing (batched vs unbatched), lifecycle signal propagation, destroy idempotency, TEARDOWN cascading, withConnectionStatus full lifecycle, transfer extractors, edge cases (no stores, post-destroy, dedup). Mock transport pair simulates synchronous structured clone. | S | **Done** |

**Wire protocol:**
```
{ t: 'v', s: storeName, d: value }        — value update
{ t: 'b', u: Record<string, any> }        — batch value update (coalesced)
{ t: 's', s: storeName, sig: string }      — lifecycle signal (serialized symbol)
{ t: 'r', stores: Record<string, any> }    — worker ready (names + initial values)
{ t: 'i', stores: Record<string, any> }    — main sends initial values
```

**Send coalescing design:** Uses `derived([...allExposedStores])` + `effect()`. When multiple
stores change in a `batch()`, two-phase push (DIRTY then DATA) + bitmask resolution means the
derived computes exactly once → one `postMessage`. No microtask, no timing hacks — pure
callbag reactive semantics. Unbatched changes send individually (correct behavior).

**H2 dependency:** Worker bridge enables H2 AI Chat's SharedWorker memory manager.
Cross-tab shared summarization + IndexedDB writes without `postMessage` plumbing.

**Phase 8c precursor:** `WorkerTransport` generalizes to any bidirectional message channel.
Redis, NATS, Unix socket adapters can reuse the same transport interface.

### Phase 8: Persistence + Distribution

> **Goal:** Durable, verifiable, distributed reactive state. The long-term play.
>
> **Depends on:** Everything above.

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| 8a | NodeV1 (CID + prev) | Content-addressed nodes. Lazy CID computation. | L |
| 8b | RBAC wrapper | Capability-based access control. Audit via `effect()`. | L |
| 8c | Multi-agent distribution | Cross-process bridges (SharedArrayBuffer, Unix socket, TCP, Redis Streams). | XL |
| 8d | NodeV2 (caps + refs + encoding) | Full capability tokens, CBOR encoding, reference tracking. | L |

---

## Effort Key

| Size | Meaning |
|------|---------|
| **S** | Half day or less |
| **M** | 1-2 days |
| **L** | 3-4 days |
| **XL** | 5+ days |
