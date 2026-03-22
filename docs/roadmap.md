# Roadmap

> **Vision:** 川流不息，唯取一瓢 — "State that flows."

---

## What's Shipped

170+ modules across 12 categories. Full inventory in `src/archive/docs/roadmap-v0.4.0-shipped.md`.

| Category | Count | Highlights |
|----------|------:|------------|
| Core | 11 | `producer`, `state`, `derived`, `dynamicDerived`, `operator`, `effect` + protocol, inspector, pipe, bitmask, types |
| Raw | 4 | `rawSubscribe`, `fromTimer`, `firstValueFrom`, `fromNodeCallback` — pure callbag, zero core deps |
| Extra | 69 | Operators (`map`, `filter`, `switchMap`, `exhaustMap`, `pausable`, `cached`, …), sources (`fromPromise`, `fromEvent`, `fromAny`, …), sinks (`subscribe`, `forEach`) |
| Utils | 31 | `retry`, `withBreaker`, `withStatus`, `withConnectionStatus`, `withSchema`, `cascadingCache`, `checkpoint` + 3 adapters (file/SQLite/IndexedDB), `track`, `dag`, `backoff`, `circuitBreaker`, `rateLimiter`, `tokenTracker`, `priorityQueue`, `namespace`, `transaction`, `tieredStorage`, `keyedAsync`, … |
| Data | 6 | `reactiveMap`, `reactiveLog`, `reactiveIndex`, `reactiveList`, `pubsub`, `compaction` |
| Messaging | 5 | `topic`, `subscription`, `repeatPublish`, `jobQueue`, `jobFlow` — Pulsar-inspired topic/subscription + job queues |
| Memory | 3 | `collection`, `decay`, `node` |
| Orchestrate | 17 | `pipeline`, `task`, `branch`, `approval`, `gate`, `taskState`, `executionLog`, `join`, `toMermaid`, `toD2`, `pipelineRunner`, `sensor`, `loop`, `forEach`, `onFailure`, `wait`, `subPipeline` |
| Patterns | 15 | `agentLoop`, `chatStream`, `textEditor`, `formField`, `undoRedo`, `pagination`, `commandBus`, `toolCallState`, `focusManager`, `hybridRoute`, `selection`, `textBuffer`, … |
| Adapters | 6 | `fromHTTP`, `fromLLM`, `fromMCP`, `toSSE`, `fromWebhook`, `fromWebSocket`/`toWebSocket` |
| Worker | 4 | `workerBridge`, `workerSelf`, `WorkerTransport`, wire protocol |
| Compat | 8 | Jotai, Nanostores, TC39 Signals, Zustand, Vue (`useStore`/`useSubscribe`), React (`useStore`/`useSubscribe`), Svelte (`useSubscribe`), Solid (`useSubscribe`) |

---

## In Progress

(Nothing currently in progress.)

---

## What's Shipped (recent)

### Phase 5a-0: §1.14 Compliance Pass — Complete

`taskState.source` hidden behind `inner`, JSDoc sanitized, `batch()` audit for multi-store transitions.

### Phase 5a: Uniform Metadata Pattern — Complete

`taskState` companion stores, `task()` flat companions, adapters use `withStatus()`.

### Phase 5b: Orchestration — Production Parity — Complete

`forEach` (fan-out), `onFailure` (dead letter), `wait`, `subPipeline`, `join` (merge strategies), `toMermaid`/`toD2`, `pipelineRunner`, `sensor`, `loop`, persistent execution log adapters (file/SQLite/IndexedDB), webhook response wiring.

### Phase 5c: `with*()` Wrappers & Framework Bindings — Complete

`withStatus(store)` → `Store<T> & { status, error }`. Framework bindings: Vue (`useStore`/`useSubscribe`), React (`useStore`/`useSubscribe`), Svelte (`useSubscribe`), Solid (`useSubscribe`).

### Phase 5d: Cross-Cutting Infrastructure — Complete

`PriorityQueue`, `withSchema`, `namespace`, `transaction`, `compaction`, `tieredStorage`/`cascadingCache`.

### Phase 5e: Messaging — Pulsar-Inspired Topic System — Complete

`topic` (persistent append-only stream), `subscription` (cursor-based consumer with exclusive/shared/failover/key_shared modes), `repeatPublish`, `jobQueue` (wraps topic+subscription+processing), job events + stall detection, `jobFlow` (multi-queue chaining with diagram export).

### Phase 5f: Protocol-Native Lifecycle Signals — Complete

RESET/PAUSE/RESUME/TEARDOWN as TYPE 3 STATE signals. All 6 core nodes handle lifecycle signals. Tier 2 extras forward via `onSignal`. Timer utils, memory layer, orchestrate, adapters, patterns, and compat all migrated. `subscribe()` returns `Subscription` with `signal()` method. Operator generation counter for stale closure prevention.

### Phase 5g: Worker Bridge — Complete

`WorkerTransport` (auto-detects Worker/SharedWorker/ServiceWorker/BroadcastChannel/MessagePort), `workerBridge()`/`workerSelf()` (expose/import stores across threads), lifecycle signals across wire, `withConnectionStatus()`, batch coalescing via `derived()`+`effect()`, `transfer` option for zero-copy ArrayBuffer.

---

## Backlog

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
