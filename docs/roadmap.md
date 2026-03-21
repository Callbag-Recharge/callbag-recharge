# Roadmap

> **Vision:** 川流不息，唯取一瓢 — "State that flows."

---

## What's Shipped

138 modules across 9 categories. Full inventory in `src/archive/docs/roadmap-v0.4.0-shipped.md`.

| Category | Count | Highlights |
|----------|------:|------------|
| Core | 6 | `producer`, `state`, `derived`, `dynamicDerived`, `operator`, `effect` + protocol, inspector, pipe, bitmask |
| Extra | 65 | Operators (`map`, `filter`, `switchMap`, `exhaustMap`, …), sources (`fromPromise`, `fromCron`, `fromEvent`, …), sinks (`subscribe`, `forEach`) |
| Utils | 22 | `retry`, `withBreaker`, `withStatus`, `checkpoint` + 3 adapters (file/SQLite/IndexedDB), `track`, `dag`, `backoff`, `circuitBreaker`, `rateLimiter`, `tokenTracker`, … |
| Data | 5 | `reactiveMap`, `reactiveLog`, `reactiveIndex`, `reactiveList`, `pubsub` |
| Memory | 3 | `collection`, `decay`, `node` |
| Orchestrate | 7 | `pipeline`, `task`, `branch`, `approval`, `gate`, `taskState`, `executionLog` |
| Patterns | 15 | `agentLoop`, `chatStream`, `textEditor`, `formField`, `undoRedo`, `pagination`, `commandBus`, … |
| Adapters | 6 | `fromHTTP`, `fromLLM`, `fromMCP`, `toSSE`, `fromWebhook`, `fromWebSocket`/`toWebSocket` |
| Compat | 6 | Jotai, Nanostores, TC39 Signals, Zustand, Vue (`useStore`/`useSubscribe`), React (`useStore`/`useSubscribe`) |

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

---

## Backlog

### Phase 5b: Orchestration — Production Parity

> **Goal:** Close the gaps that prevent `pipeline()` from replacing n8n/Airflow in real
> workflows. Persistence, batch processing, request-response webhooks, error routing.
>
> **Depends on:** Orchestrate + checkpoint adapters (shipped).

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| 5b-1 | Persistent execution log adapters | `fileLogAdapter`, `sqliteLogAdapter`, `indexedDBLogAdapter` for `executionLog()`. Same pattern as `checkpointAdapters`. Enables debugging past runs. | S |
| 5b-2 | `forEach` step (fan-out) | `forEach(dep, fn)` — spawns N parallel task instances from an array. n8n "Split in Batches" / Airflow `expand()`. | M |
| 5b-3 | Webhook response wiring | Wire pipeline output back as HTTP response to `fromWebhook()`. Turns trigger-only webhooks into request→process→respond cycles. | M |
| 5b-4 | `onFailure` step / dead letter | Route terminal failures to a handler step after retries exhausted. Dead letter queue pattern. | M |
| 5b-5 | `wait` node | `wait(ms \| signal)` — intentional pause (duration or external signal). Distinct from `timeout()` (guard) and `gate()` (approval). | S |
| 5b-6 | `subPipeline` step | Invoke one pipeline from another with lifecycle management. n8n "Execute Workflow" equivalent. | M |
| 5b-7 | `join` step (merge strategies) | `join(deps, strategy)` — append, merge-by-key, keep-matches-only. Beyond diamond resolution. | M |
| 5b-8 | `toMermaid` / `toD2` export | Serialize `pipeline()` graph to Mermaid or D2 diagram syntax. Inspector has the data; this adds the serializer. | S |
| 5b-9 | Pipeline runner | `pipelineRunner(pipelines[])` — supervisor for long-running pipelines: health checks, auto-restart. | L |
| 5b-10 | `sensor` step | `sensor(poll, pred, interval)` — Airflow sensor pattern. Poll external condition until true, then proceed. | S |
| 5b-11 | `loop` step | `loop(pred, steps)` — declarative iteration in pipeline builder. Repeat sub-graph until condition met. | M |

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
| 5c-3 | Svelte binding | `useSubscribe(store)` → Svelte readable store (implements Svelte store contract). | S |
| 5c-4 | Solid binding | `useSubscribe(store)` → Solid signal. Via `createSignal` + `onCleanup`. | S |

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
| H2 | **AI Chat (WebLLM)** | Chat UI running a model in-browser via WebGPU (no API key). Tokens stream in real-time, cancel mid-response, retry, token usage meter. Feels like ChatGPT lite. |
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
