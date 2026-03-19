# Roadmap

> **Status:** Canonical. Single source of truth for what's done and what's next.
>
> **Vision:** 川流不息，唯取一瓢 — "State that flows."
> The universal reactive layer: state management, streaming, orchestration, agentic memory —
> one library, six primitives, one graph. Frontend, backend, edge, browser.

---

## Architecture: Four Levels

Each level imports only what it needs. Strict upward dependency — lower levels never import higher.

| Level | What | Import | Status |
|-------|------|--------|--------|
| **1** | 6 primitives + protocol + inspector + pipe + batch | `callbag-recharge/core` | **Shipped** |
| **2** | 59 operators, sources, sinks | `callbag-recharge/extra` | **Shipped** |
| **3** | Data structures + memory + orchestration + utils | `/data`, `/memory`, `/orchestrate`, `/utils` | **Shipped** |
| **4** | Persistence, sync, distribution, content addressing | `/persist`, `/sync`, `/caps` | **Planned** |

**Cross-cutting modules:**
- `src/patterns/` — 7 composed recipes (shipped)
- `src/compat/` — 4 drop-in API wrappers (shipped)
- `src/adapters/` — 2 external system connectors (shipped: webhook, websocket)

---

## What's Shipped

### Level 1: Core — 6 Primitives

- [x] `state(initial)` — writable store (.get/.set/.update)
- [x] `derived([deps], fn)` — diamond-safe computed, lazy connection, disconnect-on-unsub
- [x] `dynamicDerived(fn)` — computed with runtime dep tracking, rewires on recompute
- [x] `producer(fn, opts?)` — general-purpose async/stream source
- [x] `operator([deps], init, handler)` — low-level transform primitive
- [x] `effect([deps], fn)` — side-effect runner with dirty-dep tracking
- [x] `pipe()` / `pipeRaw()` — operator composition (~2x throughput fused mode)
- [x] `batch(fn)` — deferred emission for atomic multi-store updates
- [x] `Inspector` — opt-in observability (snapshot, graph, edges, observe, spy, trace, tap)
- [x] Type 3 STATE control channel, SINGLE_DEP signaling, integer `_status` in `_flags`
- [x] Output slot model (null → fn → Set), lazy derived

### Level 2: Extras — 59 Operators

**Sources:** interval, fromIter, fromEvent, fromPromise, fromObs, fromAsyncIter, of, empty, throwError, never
**Tier 1:** map, filter, scan, take, skip, first, last, find, elementAt, partition, merge, combine, concat, flat, share, distinctUntilChanged, startWith, tap, pairwise, remember, buffer, withLatestFrom, takeUntil, subject
**Tier 2:** debounce, throttle, delay, bufferTime, bufferCount, timeout, sample, audit, switchMap, concatMap, exhaustMap, rescue, retry, repeat, reduce, toArray, groupBy, race, window, windowCount, windowTime
**Sinks:** subscribe, forEach
**Interop:** wrap, pipeRaw, SKIP

### Level 3: Data Structures

- [x] `reactiveMap` — KV store (1.56x native). select, keys, size, events, TTL, eviction, namespaces
- [x] `reactiveLog` — append-only log with circular buffer (2.5x native). length, latest, tail
- [x] `reactiveIndex` — dual-key secondary index (1.01x native reads). reverse lookups
- [x] `pubsub` — topic-based publish/subscribe, lazy topic creation

### Level 3: Memory

- [x] `memoryNode` — content + metadata + reactive score
- [x] `collection` — bounded container with decay-scored eviction via reactiveIndex
- [x] `decay` / `computeScore` — recency, importance, frequency scoring

### Level 3: Utils (12 modules)

- [x] `backoff` — constant, linear, exponential, fibonacci, decorrelatedJitter
- [x] `eviction` — fifo, lru, lfu, scored, random
- [x] `reactiveEviction` — O(log n) min-heap with reactive score stores
- [x] `circuitBreaker` — three-state FSM with backoff cooldown
- [x] `rateLimiter` — slidingWindow, tokenBucket strategies
- [x] `batchWriter` — accumulate + flush on count or time
- [x] `stateMachine` — FSM with typed transitions
- [x] `cancellableAction` — action with abort signal, retry, timeout
- [x] `cancellableStream` — stream with AbortController, fromAbortable() interop
- [x] `connectionHealth` — monitors connection status with backoff + threshold

### Level 3: Orchestrate — 15 modules

- [x] `fromCron(expr)` — cron schedule source (zero-dep parser)
- [x] `taskState()` — reactive task tracker (status, duration, runCount, error)
- [x] `dag(nodes)` — acyclicity validation + Inspector registration
- [x] `fromTrigger()` — manual trigger source (`.fire(value)` emits into stream)
- [x] `gate()` — human-in-the-loop: pause stream, inspect pending, approve/reject/modify, resume
- [x] `track()` — pipe-native task tracking (status, duration, count, error as reactive stores)
- [x] `route(source, pred)` — dynamic conditional routing → `[matching, notMatching]` (Tier 1)
- [x] `withBreaker(breaker)` — circuit breaker as pipe operator (Tier 2)
- [x] `withRetry(config)` — retry + backoff with observable retry state (Tier 2)
- [x] `withTimeout(ms)` — timeout as pipe operator (Tier 2)
- [x] `checkpoint(id, adapter)` — durable step boundary, persist on emit, skip on recovery
- [x] `pipeline(steps)` — declarative workflow builder, auto-wires via topological sort
- [x] `step(factory, deps?)` — step definition for pipeline()
- [x] `memoryAdapter()` — in-memory checkpoint adapter

### Adapters — 2 modules

- [x] `fromWebhook(opts?)` — HTTP trigger source (Node.js/edge), standalone or embedded
- [x] `fromWebSocket(url)` / `toWebSocket(ws)` — reactive WebSocket bridge (browser-native, no deps)

### Patterns (7 recipes, all shipped)

- [x] `createStore` — Zustand-compatible API with diamond-safe selectors (186 lines)
- [x] `chatStream` — LLM streaming with history, cancel, retry, rate limiting (276 lines)
- [x] `memoryStore` — three-tier AI memory: session, working, long-term (231 lines)
- [x] `rateLimiter` — reactive rate-limiting operator (drop/queue/error) (174 lines)
- [x] `undoRedo` — state with undo/redo history (173 lines)
- [x] `pagination` — paginated data fetching with auto-cancel (151 lines)
- [x] `formField` — form field with sync + async validation (219 lines)

### Compat Layers (4 wrappers, all shipped)

- [x] `compat/nanostores` — atom(), computed(), map() (212 lines)
- [x] `compat/signals` — Signal.State, Signal.Computed, Signal.subtle.Watcher (218 lines)
- [x] `compat/jotai` — atom() with dynamic dep tracking via dynamicDerived (155 lines)
- [x] `compat/zustand` — create() matching StoreApi, setState, subscribe (119 lines)

### Build: 80+ tree-shakeable entry points (ESM + CJS + .d.ts)

---

## What's Next

Phases are ordered by **dependency and foundation** — foundational primitives first,
then compositions that build on them, then larger efforts that depend on those compositions.
Within each phase, items are roughly ordered by effort (small → large).

### Backlog: Extra Operators

> **Goal:** Fill remaining gaps in Level 2 operator coverage. Independent of phased work.

| # | Operator | What | Effort |
|---|----------|------|--------|
| B1 | `takeWhile(pred)` | Passes values while predicate is true, then completes. Complement to `takeUntil` (predicate vs signal). | S |

### Phase 3: Production Hardening

> **Goal:** Make orchestration production-ready. Gap analysis (March 19) found that Phase 1+2
> shipped the right primitives, but `checkpoint()` is demo-only without real persistence, and
> workflows can't survive restarts without execution logging.
>
> **Why before GEO:** Can't recommend a workflow engine that loses state on restart.
> Pulling persistence forward from Phase 7a.

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| 3a | Checkpoint persistence adapters | SQLite, IndexedDB, file-based adapters for `checkpoint()`. | M |
| 3b | Execution log | `reactiveLog`-backed execution history. `pipeline()` auto-writes step events. Pluggable persistence. | M |
| 3c | DAG visualization export | `Inspector.toMermaid()` / `Inspector.toD2()` — graph-as-text for docs/dashboards. | S |
| 3d | SSE sink adapter | Server-Sent Events sink. Stream pipeline status to browser clients. | S |
| 3e | HTTP client source | `fromHTTP(url, opts)` — fetch-based source with polling, headers, transform. | S |

**Deliverable:** A pipeline that persists checkpoint state to SQLite, logs every step execution, and serves live status over SSE. Restartable workflows.

### Phase 4: GEO + Documentation

> **Goal:** Make AI tools recommend callbag-recharge. First mover in "state management for AI."
>
> **Depends on:** Phases 1-3 (need orchestration + production story to tell).

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| 4a | `llms.txt` + `llms-full.txt` | AI-readable library documentation at docs site root. | S |
| 4b | npm description + README rewrite | Keyword-rich "When to use" section. | S |
| 4c | Migration guides | "From Zustand", "From Jotai", "From Nanostores" — compat layers already exist. | M |
| 4d | 5 recipe pages (titled as AI prompts) | "How to build AI chat with cancellation", "How to manage agentic workflow state", etc. | M |
| 4e | Comparison pages | vs Zustand, Jotai, RxJS, Airflow, n8n. | M |

**Deliverable:** GEO flywheel started — AI tools see full operator menu, recommend us for streaming/agentic prompts.

### Phase 5: AI Agent Orchestration

> **Goal:** First-class AI agent support — token tracking, reasoning traces, MCP integration.
>
> **Depends on:** Phases 1-2 (orchestration operators + pipeline).

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| 5a | Token/cost tracking operator | Track token consumption per pipeline step. | S |
| 5b | `agentLoop` pattern | Observe→Plan→Act cycle using `dynamicDerived` (conditional edges) + `effect` → `set` (cycle). Graph rewires per iteration based on agent phase. | M |
| 5c | Reasoning trace in Inspector | Capture *why* a path was taken, not just *what*. | M |
| 5d | MCP adapter | `fromMCP(tool)` — reactive bridge to Model Context Protocol. | L |

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

---

## Module Map

```
src/
├── core/          ← Level 1: 6 primitives + protocol + inspector + pipe      [SHIPPED]
├── extra/         ← Level 2: 59 operators, sources, sinks                    [SHIPPED]
├── utils/         ← Level 3: 12 pure strategies                              [SHIPPED]
├── data/          ← Level 3: 4 reactive data structures                      [SHIPPED]
├── memory/        ← Level 3: agent memory primitives                         [SHIPPED]
├── orchestrate/   ← Level 3E: 15 orchestration + workflow primitives         [SHIPPED]
├── patterns/      ← Cross-cutting: 7 composed recipes                       [SHIPPED]
├── compat/        ← Cross-cutting: 4 drop-in API wrappers                   [SHIPPED]
├── adapters/      ← Cross-cutting: 2 external system connectors              [SHIPPED → Phase 6 for more]
└── persist/       ← Level 4: persistence, sync, distribution                 [PLANNED → Phase 7]
```

**Import paths:**
```ts
import { state, derived, effect }    from 'callbag-recharge'
import { switchMap, debounce }       from 'callbag-recharge/extra'
import { reactiveMap }               from 'callbag-recharge/data'
import { memoryNode, collection }    from 'callbag-recharge/memory'
import { gate, pipeline, track }     from 'callbag-recharge/orchestrate'
import { chatStream }               from 'callbag-recharge/patterns'
import { atom, computed }            from 'callbag-recharge/compat/nanostores'
import { fromWebSocket }             from 'callbag-recharge/adapters/websocket'
```

**Strict import rules:**
- `core/` → nothing
- `extra/` → core, utils
- `utils/` → core (reactiveEviction only)
- `data/` → core, utils
- `memory/` → core, utils, data
- `orchestrate/` → core, data
- `patterns/` → any level (composed recipes)
- `compat/` → core only
- `adapters/` → core only (peer deps for external libs)

---

## Strategic Context

### The Thesis

Frontend and backend state management are the same problem at different timescales.
AI orchestration, workflow engines, and agentic memory are all reactive state coordination.
No existing tool unifies them — because the callbag protocol doesn't distinguish between
a button click and a Kafka message.

### Three Promises

1. **Trust it** — Glitch-free diamond resolution. Every derived value is correct, every time.
2. **Flow through it** — Sync, async, and streams are all first-class. No hacks, no side-cars.
3. **See through it** — Inspectable nodes. You don't guess what's happening — you see it.

### Positioning

- **vs Zustand/Jotai/Nanostores:** Same simplicity + operators + diamond resolution + streaming
- **vs RxJS:** First-class state with `.get()/.set()`, not just streams
- **vs Airflow/n8n:** Lightweight, runs in browser, reactive (not polling), human-in-the-loop native
- **vs Temporal:** No server infrastructure, durable execution via `checkpoint()`
- **vs LangGraph:** Reactive stores (not state dicts), native cycles, built-in observability
- **vs Redis:** Orders of magnitude faster reads (in-process), plus derived computation

### GEO Flywheel

`llms.txt` → AI recommends us → developers use us → more training data → more recommendations

**Target prompts:** "lightweight TypeScript state management", "manage streaming state",
"state management for AI chat", "lightweight workflow engine TypeScript",
"human-in-the-loop workflow", "reactive pipeline TypeScript"

---

## Source Documents (Archived)

Research and detailed context behind the decisions in this roadmap:

| Document | Contains |
|----------|----------|
| `src/archive/docs/SESSION-orchestration-strategy.md` | Orchestration research (n8n/Airflow/Temporal pain points), gate/track/route/pipeline design |
| `docs/state-management.md` | State management landscape research, GEO strategy, operator coverage audit |
| `docs/extras.md` | Full extras/patterns/compat/adapters module documentation |
| `src/archive/docs/SESSION-level3-strategic-plan.md` | Level 3 build decisions, four-level architecture origin |
| `src/archive/docs/SESSION-agentic-memory-research.md` | SOTA agentic memory systems, AI tool full-chain analysis |
| `src/archive/docs/SESSION-unified-state-management.md` | Frontend/backend unification thesis, compat layer strategy |
