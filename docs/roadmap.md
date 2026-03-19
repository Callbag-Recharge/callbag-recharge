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
| **3** | Data structures + memory + orchestration + utils | `/data`, `/memory`, `/orchestrate`, `/utils` | **Shipped** (orchestrate partial) |
| **4** | Persistence, sync, distribution, content addressing | `/persist`, `/sync`, `/caps` | **Planned** |

**Cross-cutting modules:**
- `src/patterns/` — 7 composed recipes (shipped)
- `src/compat/` — 4 drop-in API wrappers (shipped)
- `src/adapters/` — external system connectors (planned)

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

### Level 3: Orchestrate (partial)

- [x] `fromCron(expr)` — cron schedule source (zero-dep parser)
- [x] `taskState()` — reactive task tracker (status, duration, runCount, error)
- [x] `dag(nodes)` — acyclicity validation + Inspector registration

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

### Build: 68 tree-shakeable entry points (ESM + CJS + .d.ts)

---

## What's Next

Phases are ordered by **dependency and foundation** — foundational primitives first,
then compositions that build on them, then larger efforts that depend on those compositions.
Within each phase, items are roughly ordered by effort (small → large).

### Phase 1: Orchestration Operators (Foundation)

> **Goal:** The pipe-native operators that make workflow composition possible.
> These are the building blocks everything else depends on — `pipeline()`, the airflow demo
> rewrite, and AI agent orchestration all need these operators to exist first.
>
> **Why first:** Without these, every workflow falls back to imperative async/await.
> `gate()` alone is a novel primitive no other lightweight library has.

| # | Primitive | What | Effort |
|---|-----------|------|--------|
| 1a | `fromTrigger()` | Manual trigger source. `.fire(value)` emits into the stream. | S |
| 1b | `route(source, pred)` | Dynamic conditional routing → `[matching, notMatching]` both as stores. | S |
| 1c | `withTimeout(ms)` | Timeout as pipe operator. Composes existing `timeout()`. | S |
| 1d | `withBreaker(opts)` | Circuit breaker as pipe operator. Blocks when open, trials on half-open. | S |
| 1e | `withRetry(n, backoff)` | Retry + backoff as operator with observable retry state. | S |
| 1f | `track()` | Pipe-native task tracking. Observable metadata (status, duration, runCount, error). | M |
| 1g | `gate()` | Human-in-the-loop: pause stream, inspect pending, approve/reject/modify, resume. | M-L |

**Deliverable:** Rewrite the airflow demo with zero `async/await`.

### Backlog: Extra Operators

> **Goal:** Fill remaining gaps in Level 2 operator coverage. Independent of phased work.

| # | Operator | What | Effort |
|---|----------|------|--------|
| B1 | `takeWhile(pred)` | Passes values while predicate is true, then completes. Complement to `takeUntil` (predicate vs signal). | S |

### Phase 2: Workflow Engine + Adapters

> **Goal:** Compose Phase 1 operators into a declarative workflow builder. Ship the first
> adapters so workflows can connect to external systems.
>
> **Depends on:** Phase 1 (operators are the building blocks for `pipeline()`).

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| 2a | `fromWebhook()` | HTTP trigger source (Node.js/edge). | S |
| 2b | WebSocket adapter | `fromWebSocket(url)` / `toWebSocket(ws)`. No deps (browser native). | S |
| 2c | `checkpoint(id, adapter)` | Durable step boundary. Persist on emit, skip on recovery. Pluggable adapter. | M |
| 2d | `pipeline()` | Declarative workflow builder. Steps declare deps, auto-wires derived + operators. Reactive status per step. | L |
| 2e | Airflow demo v2 | Rewrite using `pipeline()` + `gate()` + `track()`. Side-by-side with v1. | M |

**Deliverable:** "n8n in 50 lines" — trigger → parallel fetch → gate → conditional routing → sinks.

### Phase 3: GEO + Documentation

> **Goal:** Make AI tools recommend callbag-recharge. First mover in "state management for AI."
>
> **Depends on:** Phases 1-2 (need orchestration story to tell). Patterns/compat already shipped.

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| 3a | `llms.txt` + `llms-full.txt` | AI-readable library documentation at docs site root. | S |
| 3b | npm description + README rewrite | Keyword-rich "When to use" section. | S |
| 3c | Migration guides | "From Zustand", "From Jotai", "From Nanostores" — compat layers already exist. | M |
| 3d | 5 recipe pages (titled as AI prompts) | "How to build AI chat with cancellation", "How to manage agentic workflow state", etc. | M |
| 3e | Comparison pages | vs Zustand, Jotai, RxJS, Airflow, n8n. | M |

**Deliverable:** GEO flywheel started — AI tools see full operator menu, recommend us for streaming/agentic prompts.

### Phase 4: AI Agent Orchestration

> **Goal:** First-class AI agent support — token tracking, reasoning traces, MCP integration.
>
> **Depends on:** Phases 1-2 (orchestration operators + pipeline).

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| 4a | Token/cost tracking operator | Track token consumption per pipeline step. | S |
| 4b | `agentLoop` pattern | Observe→Plan→Act cycle using `dynamicDerived` (conditional edges) + `effect` → `set` (cycle). Graph rewires per iteration based on agent phase. | M |
| 4c | Reasoning trace in Inspector | Capture *why* a path was taken, not just *what*. | M |
| 4d | MCP adapter | `fromMCP(tool)` — reactive bridge to Model Context Protocol. | L |

### Phase 5: Deep Memory

> **Goal:** Reactive agentic memory that no other library offers — vector search, knowledge
> graphs, memory lifecycle. Builds on shipped memoryNode/collection/decay + memoryStore pattern.
>
> **Depends on:** Level 3 data structures (shipped).

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| 5a | Session transport adapters | SSE sink, WebSocket sink, HTTP sink. Same graph, different edge. | M |
| 5b | In-process vector index | HNSW-based semantic search. ~1-10 μs vs Redis ~50-500 μs. | L |
| 5c | Knowledge graph (reactive) | Entity relationships with temporal tracking. Graph-based retrieval. | XL |
| 5d | Consolidation + self-editing | Memory lifecycle: dedup, summarize, forget. Admission control. | L |

### Phase 6: More Adapters

> **Goal:** Connect any external system with thin (~20-50 line) adapters.
>
> **Depends on:** Phase 2a-2b (adapter pattern established).

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| 6a | Redis adapter | `fromRedis(sub, channel)` / `toRedis(pub, channel)`. Peer dep: ioredis. | S |
| 6b | PostgreSQL adapter | `fromPgNotify(pool, channel)`. Peer dep: pg. | S |
| 6c | Kafka adapter | `fromKafka(consumer, topic)` / `toKafka(producer, topic)`. Peer dep: kafkajs. | M |

### Phase 7: Level 4 — Persistence + Distribution

> **Goal:** Durable, verifiable, distributed reactive state. The long-term play.
>
> **Depends on:** Everything above — this wraps Level 3 with opt-in capabilities.

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| 7a | Persistence adapters | SQLite, IndexedDB, S3 via `effect()`. For `checkpoint()` + `memoryStore`. | M |
| 7b | NodeV1 (CID + prev) | Content-addressed nodes. Lazy CID computation. | L |
| 7c | RBAC wrapper | Capability-based access control. Audit via `effect()`. | L |
| 7d | Multi-agent distribution | Cross-process bridges (SharedArrayBuffer, Unix socket, TCP, Redis Streams). | XL |
| 7e | NodeV2 (caps + refs + encoding) | Full capability tokens, CBOR encoding, reference tracking. | L |

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
├── orchestrate/   ← Level 3E: scheduling + workflow engine                   [PARTIAL → Phase 1+2]
├── patterns/      ← Cross-cutting: 7 composed recipes                       [SHIPPED]
├── compat/        ← Cross-cutting: 4 drop-in API wrappers                   [SHIPPED]
├── adapters/      ← Cross-cutting: external system connectors                [PLANNED → Phase 2+6]
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
