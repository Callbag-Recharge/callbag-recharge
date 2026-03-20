# Roadmap

> **Vision:** 川流不息，唯取一瓢 — "State that flows."

---

## What's Shipped

138 modules across 9 categories. Full inventory in `src/archive/docs/roadmap-v0.4.0-shipped.md`.

| Category | Count | Highlights |
|----------|------:|------------|
| Core | 6 | `producer`, `state`, `derived`, `dynamicDerived`, `operator`, `effect` + protocol, inspector, pipe, bitmask |
| Extra | 65 | Operators (`map`, `filter`, `switchMap`, `exhaustMap`, …), sources (`fromPromise`, `fromCron`, `fromEvent`, …), sinks (`subscribe`, `forEach`) |
| Utils | 21 | `retry`, `withBreaker`, `checkpoint` + 3 adapters (file/SQLite/IndexedDB), `track`, `dag`, `backoff`, `circuitBreaker`, `rateLimiter`, `tokenTracker`, … |
| Data | 5 | `reactiveMap`, `reactiveLog`, `reactiveIndex`, `reactiveList`, `pubsub` |
| Memory | 3 | `collection`, `decay`, `node` |
| Orchestrate | 7 | `pipeline`, `task`, `branch`, `approval`, `gate`, `taskState`, `executionLog` |
| Patterns | 15 | `agentLoop`, `chatStream`, `textEditor`, `formField`, `undoRedo`, `pagination`, `commandBus`, … |
| Adapters | 6 | `fromHTTP`, `fromLLM`, `fromMCP`, `toSSE`, `fromWebhook`, `fromWebSocket`/`toWebSocket` |
| Compat | 4 | Jotai, Nanostores, TC39 Signals, Zustand |

---

## In Progress

*(Nothing currently in progress)*

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
