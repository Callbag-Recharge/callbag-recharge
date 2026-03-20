# Roadmap

> **Status:** In-progress and backlogged work only. Shipped items archived in
> `src/archive/docs/roadmap-v0.4.0-shipped.md`.
>
> **Vision:** 川流不息，唯取一瓢 — "State that flows."

---

## What's Shipped (summary)

| Level | What | Status |
|-------|------|--------|
| **1** | 6 core primitives + protocol + inspector + pipe + batch | Shipped |
| **2** | 60 extra operators, sources, sinks | Shipped |
| **3** | Data (4) + memory (3) + orchestrate (18) + utils (15) | Shipped |
| **Cross-cutting** | Patterns (13) + adapters (6) + compat (4) | Shipped |
| **Phases 1-5** | Core → extras → production hardening → GEO/docs → AI agent orchestration | Shipped |

For full shipped inventory see `src/archive/docs/roadmap-v0.4.0-shipped.md`.

---

## In Progress

*(Nothing currently in progress)*

---

## Backlog

### Phase 6: Deep Memory

> **Goal:** Reactive agentic memory that no other library offers — vector search, knowledge
> graphs, memory lifecycle. Builds on shipped memoryNode/collection/decay + memoryStore pattern.
>
> **Depends on:** Level 3 data structures (shipped).

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| 6a | Session transport adapters | WebSocket sink, HTTP sink. Same graph, different edge. | M |
| 6b | In-process vector index | HNSW-based semantic search. ~1-10 μs vs Redis ~50-500 μs. | L |
| 6c | Knowledge graph (reactive) | Entity relationships with temporal tracking. Graph-based retrieval. | XL |
| 6d | Consolidation + self-editing | Memory lifecycle: dedup, summarize, forget. Admission control. | L |

### Phase 7: More Adapters

> **Goal:** Connect any external system with thin (~20-50 line) adapters.
>
> **Depends on:** Adapter pattern established (webhook + websocket shipped).

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| 7a | Redis adapter | `fromRedis(sub, channel)` / `toRedis(pub, channel)`. Peer dep: ioredis. | S |
| 7b | PostgreSQL adapter | `fromPgNotify(pool, channel)`. Peer dep: pg. | S |
| 7c | Kafka adapter | `fromKafka(consumer, topic)` / `toKafka(producer, topic)`. Peer dep: kafkajs. | M |

### Phase 8: Level 4 — Persistence + Distribution

> **Goal:** Durable, verifiable, distributed reactive state. The long-term play.
>
> **Depends on:** Everything above — this wraps Level 3 with opt-in capabilities.

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
