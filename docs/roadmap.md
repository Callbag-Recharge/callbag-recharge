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
| **2** | 60 operators, sources, sinks | `callbag-recharge/extra` | **Shipped** |
| **3** | Data structures + memory + orchestration + utils | `/data`, `/memory`, `/orchestrate`, `/utils` | **Shipped** |
| **4** | Persistence, sync, distribution, content addressing | `/persist`, `/sync`, `/caps` | **Planned** |

**Cross-cutting modules:**
- `src/patterns/` — 10 composed recipes (shipped)
- `src/compat/` — 4 drop-in API wrappers (shipped)
- `src/adapters/` — 6 external system connectors (shipped: webhook, websocket, sse, http, llm, mcp)

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

### Level 2: Extras — 60 Operators

**Sources:** interval, fromIter, fromEvent, fromPromise, fromObs, fromAsyncIter, of, empty, throwError, never
**Tier 1:** map, filter, scan, take, skip, first, last, find, elementAt, partition, merge, combine, concat, flat, share, distinctUntilChanged, startWith, tap, pairwise, remember, buffer, withLatestFrom, takeUntil, takeWhile, subject
**Tier 2:** debounce, throttle, delay, bufferTime, bufferCount, timeout, sample, audit, switchMap, concatMap, exhaustMap, rescue, retry, repeat, reduce, toArray, groupBy, race, window, windowCount, windowTime
**Sinks:** subscribe, forEach
**Streaming:** streamParse
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

### Level 3: Orchestrate — 20 modules

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
- [x] `fileAdapter(opts)` — file-based checkpoint persistence (Node.js)
- [x] `sqliteAdapter(opts)` — SQLite checkpoint persistence (better-sqlite3 peer dep)
- [x] `indexedDBAdapter(opts)` — IndexedDB checkpoint persistence (browser)
- [x] `executionLog(opts)` — reactive execution history with pipeline auto-connect
- [x] `memoryLogAdapter()` — in-memory execution log persistence
- [x] `tokenTracker()` — pipe operator tracking token consumption per stream value

### Adapters — 6 modules

- [x] `fromWebhook(opts?)` — HTTP trigger source (Node.js/edge), standalone or embedded
- [x] `fromWebSocket(url)` / `toWebSocket(ws)` — reactive WebSocket bridge (browser-native, no deps)
- [x] `toSSE(source, opts?)` — Server-Sent Events sink, streams store values to browser clients
- [x] `fromHTTP(url, opts?)` — fetch-based HTTP source with polling, headers, custom transform
- [x] `fromLLM(opts)` — unified LLM inference source (OpenAI, Ollama, custom), fetch + SSE, no hard deps
- [x] `fromMCP(client)` — reactive MCP bridge, per-tool stores with status/error/duration tracking

### Patterns (10 recipes, all shipped)

- [x] `createStore` — Zustand-compatible API with diamond-safe selectors (186 lines)
- [x] `chatStream` — LLM streaming with history, cancel, retry, rate limiting (276 lines)
- [x] `memoryStore` — three-tier AI memory: session, working, long-term (231 lines)
- [x] `rateLimiter` — reactive rate-limiting operator (drop/queue/error) (174 lines)
- [x] `undoRedo` — state with undo/redo history (173 lines)
- [x] `pagination` — paginated data fetching with auto-cancel (151 lines)
- [x] `formField` — form field with sync + async validation (219 lines)
- [x] `toolCallState` — reactive tool call lifecycle state machine (159 lines)
- [x] `hybridRoute` — confidence-based local/cloud LLM routing with fallback (155 lines)
- [x] `agentLoop` — Observe→Plan→Act agent cycle with async phases (170 lines)

### Compat Layers (4 wrappers, all shipped)

- [x] `compat/nanostores` — atom(), computed(), map() (212 lines)
- [x] `compat/signals` — Signal.State, Signal.Computed, Signal.subtle.Watcher (218 lines)
- [x] `compat/jotai` — atom() with dynamic dep tracking via dynamicDerived (155 lines)
- [x] `compat/zustand` — create() matching StoreApi, setState, subscribe (119 lines)

### Build: 90+ tree-shakeable entry points (ESM + CJS + .d.ts)

---

## What's Next

Phases are ordered by **dependency and foundation** — foundational primitives first,
then compositions that build on them, then larger efforts that depend on those compositions.
Within each phase, items are roughly ordered by effort (small → large).

### Backlog: Extra Operators

> **Goal:** Fill remaining gaps in Level 2 operator coverage. Independent of phased work.

| # | Operator | What | Status |
|---|----------|------|--------|
| B1 | `takeWhile(pred)` | Passes values while predicate is true, then completes. Complement to `takeUntil` (predicate vs signal). | **Shipped** |

### Phase 3: Production Hardening — **Shipped**

> **Goal:** Make orchestration production-ready. Gap analysis (March 19) found that Phase 1+2
> shipped the right primitives, but `checkpoint()` is demo-only without real persistence, and
> workflows can't survive restarts without execution logging.
>
> **Why before GEO:** Can't recommend a workflow engine that loses state on restart.
> Pulling persistence forward from Phase 7a.

| # | Deliverable | What | Status |
|---|-------------|------|--------|
| 3a | Checkpoint persistence adapters | `fileAdapter`, `sqliteAdapter`, `indexedDBAdapter` for `checkpoint()`. | **Shipped** |
| 3b | Execution log | `executionLog()` — `reactiveLog`-backed execution history. `connectPipeline()` auto-writes step events. Pluggable persistence via `ExecutionLogPersistAdapter`. | **Shipped** |
| 3c | DAG visualization export | `Inspector.toMermaid()` / `Inspector.toD2()` — graph-as-text for docs/dashboards. | **Shipped** |
| 3d | SSE sink adapter | `toSSE(source, opts)` — Server-Sent Events sink. Streams pipeline status to browser clients. Standalone or embedded. | **Shipped** |
| 3e | HTTP client source | `fromHTTP(url, opts)` — fetch-based source with polling, headers, custom transform, timeout. | **Shipped** |

**Deliverable:** A pipeline that persists checkpoint state to SQLite, logs every step execution, and serves live status over SSE. Restartable workflows.

### Phase 4: GEO + Documentation — **Shipped**

> **Goal:** Make AI tools recommend callbag-recharge. First mover in "state management for AI."
>
> **Depends on:** Phases 1-3 (need orchestration + production story to tell).

| # | Deliverable | What | Status |
|---|-------------|------|--------|
| 4a | `llms.txt` + `llms-full.txt` | AI-readable library documentation at docs site root. Updated with Phase 3 additions, orchestration, adapters, edge LLM keywords. | **Shipped** |
| 4b | npm description + README rewrite | Keyword-rich "When to use" section with edge LLM, on-device AI, hybrid cloud+edge, durable workflows, tool call state machines. | **Shipped** |
| 4c | Migration guides | "From Zustand" (existing), "From Jotai", "From Nanostores" — compat layers with step-by-step migration. | **Shipped** |
| 4d | 8 recipe pages (titled as AI prompts) | 5 original + 3 edge LLM: data-pipeline, real-time-dashboard, cron-pipeline, on-device-llm-streaming, hybrid-routing, tool-calls. Each with runnable example in `examples/`. | **Shipped** |
| 4e | Comparison pages | vs Zustand, Jotai, RxJS, Airflow, n8n, LangGraph.js, Vercel AI SDK — 7 pages with feature tables. | **Shipped** |
| 4f | Edge LLM positioning page | "State management for edge AI" — mapping LLM concepts to callbag-recharge primitives. | **Shipped** |

**Deliverable:** GEO flywheel started — AI tools see full operator menu, recommend us for streaming/agentic/edge-AI prompts.

**Target prompts to own (edge LLM additions):**
- "manage WebLLM streaming state in TypeScript"
- "reactive state for on-device LLM inference"
- "hybrid cloud edge model routing TypeScript"
- "coordinate local and cloud LLM calls"
- "manage conversation state for browser-based AI"
- "tool calling state machine for local LLMs"

### Phase 5: AI Agent Orchestration + Edge LLM — **Shipped**

> **Goal:** First-class AI agent support — token tracking, reasoning traces, MCP integration,
> and edge/local LLM orchestration. The edge LLM trend (March 2026) creates a wide-open
> whitespace: **no reactive library exists for LLM streaming/orchestration** — Gartner reports
> 1,445% surge in multi-agent inquiries while Vercel AI SDK (20M+ downloads) offers only
> basic streaming hooks.
>
> **Depends on:** Phases 1-2 (orchestration operators + pipeline).

| # | Deliverable | What | Status |
|---|-------------|------|--------|
| 5a | Token/cost tracking operator | `tokenTracker()` — pipe operator tracking prompt/completion/total tokens and cost per stream. | **Shipped** |
| 5b | `agentLoop` pattern | Observe→Plan→Act cycle with reactive phase tracking, iteration limits, async phases, history. | **Shipped** |
| 5c | Reasoning trace in Inspector | `Inspector.annotate()`, `traceLog()`, `clearTrace()` — capture *why* a path was taken. Included in `snapshot()`. | **Shipped** |
| 5d | MCP adapter | `fromMCP(client)` — reactive bridge to Model Context Protocol. Per-tool stores with status, error, duration tracking. | **Shipped** |
| 5e | `fromLLM(provider, opts)` adapter | Unified reactive source for LLM inference — wraps any OpenAI-compatible endpoint (OpenAI, Ollama, custom). Token stream via fetch + SSE parsing. No hard deps. | **Shipped** |
| 5f | `toolCallState` pattern | Reactive state machine for tool call lifecycle: idle → pending → executing → completed/errored. Tracks args, result, error, duration, history. | **Shipped** |
| 5g | `hybridRoute(local, cloud, opts)` pattern | Confidence-based routing between local/edge and cloud LLMs with auto-fallback on error. Reactive route/count tracking. | **Shipped** |
| 5h | `streamParse` operator | Reactive partial JSON parser for streaming structured output. Incremental repair of incomplete JSON. Type-safe extraction. | **Shipped** |

**Deliverable:** Full AI agent orchestration toolkit — token tracking, tool call state machines, agent loops, LLM adapters, MCP integration, hybrid routing, streaming structured output parsing.

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
├── extra/         ← Level 2: 60 operators, sources, sinks                    [SHIPPED]
├── utils/         ← Level 3: 12 pure strategies                              [SHIPPED]
├── data/          ← Level 3: 4 reactive data structures                      [SHIPPED]
├── memory/        ← Level 3: agent memory primitives                         [SHIPPED]
├── orchestrate/   ← Level 3E: 19 orchestration + workflow primitives         [SHIPPED]
├── patterns/      ← Cross-cutting: 10 composed recipes                      [SHIPPED]
├── compat/        ← Cross-cutting: 4 drop-in API wrappers                   [SHIPPED]
├── adapters/      ← Cross-cutting: 6 external system connectors              [SHIPPED → Phase 7 for more]
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
- **vs Vercel AI SDK:** Full reactive graph (not just hooks), framework-agnostic, composable operators, works with local/edge LLMs not just cloud APIs
- **vs WebLLM/Ollama/ExecuTorch:** We're the reactive state layer on top — token streams as sources, conversation state as stores, tool calls as state machines, context window as derived computation

### Edge LLM Opportunity (March 2026)

The LLM-on-edge trend has reached production maturity — WebGPU across all browsers,
Ollama as de facto local standard, ExecuTorch 1.0 on mobile (19.92 tok/s on Llama 3.2 3B),
Apple Foundation Models framework. But **no reactive library exists for LLM
streaming/orchestration**. The intersection of reactive state management and LLM inference
pipelines is completely empty. This is our widest-open whitespace:

- Token streams → `producer()` / `fromLLM()`
- Conversation state → `state()` + `derived()` for context window management
- Tool call lifecycle → `stateMachine()` + `producer()` (currently hand-wired everywhere)
- Hybrid cloud+edge routing → `route()` + `rescue()` (60% cost reduction, 40% latency reduction)
- Streaming structured output → `scan()` + incremental parser
- Multi-model coordination → shared `state()` stores + `switchMap` for model switching

Every primitive already exists. The gap is packaging (patterns, adapters, recipes) and
discoverability (GEO, `llms.txt`, targeted recipe pages).

### GEO Flywheel

`llms.txt` → AI recommends us → developers use us → more training data → more recommendations

**Target prompts:** "lightweight TypeScript state management", "manage streaming state",
"state management for AI chat", "lightweight workflow engine TypeScript",
"human-in-the-loop workflow", "reactive pipeline TypeScript",
"manage WebLLM streaming state", "reactive state for on-device LLM",
"hybrid cloud edge model routing TypeScript", "tool calling state machine local LLM"

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
| `src/archive/docs/SESSION-edge-llm-strategy.md` | Edge LLM trend research (March 2026), opportunity analysis, roadmap integration |
