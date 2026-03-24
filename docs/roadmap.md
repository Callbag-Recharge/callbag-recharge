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
| Memory | 4 | `collection`, `decay`, `node`, `vectorIndex` (HNSW) |
| Orchestrate | 17 | `pipeline`, `task`, `branch`, `approval`, `gate`, `taskState`, `executionLog`, `join`, `toMermaid`, `toD2`, `pipelineRunner`, `sensor`, `loop`, `forEach`, `onFailure`, `wait`, `subPipeline` |
| Patterns | 15 | `agentLoop`, `chatStream`, `textEditor`, `formField`, `undoRedo`, `pagination`, `commandBus`, `toolCallState`, `focusManager`, `hybridRoute`, `selection`, `textBuffer`, … |
| Adapters | 6 | `fromHTTP`, `fromLLM`, `fromMCP`, `toSSE`, `fromWebhook`, `fromWebSocket`/`toWebSocket` |
| Worker | 4 | `workerBridge`, `workerSelf`, `WorkerTransport`, wire protocol |
| Compat | 8 | Jotai, Nanostores, TC39 Signals, Zustand, Vue (`useStore`/`useSubscribe`/`useSubscribeRecord`), React (`useStore`/`useSubscribe`), Svelte (`useSubscribe`), Solid (`useSubscribe`) |

---

## In Progress

(Nothing currently in progress.)

---

## Backlog

### Security: Markdown preview XSS via `javascript:` URLs

`markdown-editor-hero.ts` `escapeInline` converts markdown links to `<a href="$2">`. A crafted link like `[click](javascript:alert(1))` creates a live XSS vector when rendered via `v-html`. Fix: sanitize hrefs to only allow `http:`, `https:`, `mailto:` protocols.

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

### Phase 6d: Memory Lifecycle — Complete

`admissionPolicy` on `collection` — gate every `add()` with admit/reject/update/merge decisions for reactive dedup and conflict resolution. `forgetPolicy` — quality predicate pruned before each admission and on explicit `gc()`. `summarize(nodeIds, reducer)` — atomic consolidation of multiple nodes into one (single `batch()` wave). All policies run synchronously through the reactive graph. 14 new tests.

### Phase 6b: In-Process Vector Index — Complete

`vectorIndex` — pure TypeScript HNSW (Hierarchical Navigable Small World) implementation. Cosine, Euclidean, and dot-product distance metrics. ~1-10 μs search for <10K vectors. Zero dependencies. Ships in `src/memory/`. Reactive `size` store. `VectorIndex`, `VectorIndexOptions`, `VectorSearchResult` types exported from `callbag-recharge/memory`.

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

| # | App | Status | What the user experiences |
|---|-----|--------|--------------------------|
| H1 | **Markdown Editor** | **Shipped** | Split-pane: textarea left, live Markdown preview right. Toolbar with undo/redo, heading/bold/italic/code/list formatting, word count, cursor position, auto-save dot. Feels like a real editor. |
| H2 | **AI Docs Assistant (WebLLM)** | Backlog | Edge-first documentation assistant. Progressive: starts as instant FTS5 search (no download), upgrades to AI chat with semantic search when user opts in. Qwen3 model runs in-browser via WebGPU — no API key, no data leaves device. Remembers user's project context across sessions via reactive memory. LLM recommends high-level `ai/` primitives, presents relevant API docs and examples. Three workers: Web Worker (WebLLM inference), SharedWorker (cross-tab memory via `workerBridge` + IndexedDB), Service Worker (model weight cache). Depends on Phase 6 (memory), Phase 7 (adapters), `ai/` folder. Feels like a privacy-first Copilot for the library. |
| H3 | **Workflow Builder** | **Shipped** | Code-first n8n. Left: editable script pane with `pipeline()` code. Right: live DAG (Vue Flow). Presets load example code. Press "Update" → code parses into a visual graph. Fire triggers, watch nodes animate through states, inspect per-node logs with circuit breaker controls. Configurable duration/failure sliders. Feels like a workflow tool. |

**Build order:** H1 (shipped) → H3 (shipped) → H2 (after Phase 7.1)

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
> **Depends on:** Data structures (shipped), memoryNode/collection/decay/vectorIndex (shipped).
>
> **Market validation (March 2026):** OpenClaw integrated Mem0 (hybrid vector + graph) as
> built-in agent memory — confirms demand for structured memory backends in AI tools. Our
> differentiator: reactive/push-based (vs Mem0's pull-only), in-process (vs service call),
> diamond-safe updates, transport-agnostic.

| # | Deliverable | What | Effort |
|---|-------------|------|--------|
| ~~6b~~ | ~~In-process vector index~~ | **Shipped** — `vectorIndex` HNSW in `src/memory/`. | — |
| ~~6d~~ | ~~Consolidation + self-editing~~ | **Shipped** — `admissionPolicy` (admit/reject/update/merge), `forgetPolicy`, `summarize()`, `gc()` on `collection`. | — |
| 6a | Session transport adapters | WebSocket sink, HTTP sink. Same graph, different edge. | M |
| 6c | Knowledge graph (reactive) | Entity relationships with temporal tracking. Graph-based retrieval. | XL |
| 6e | Lightweight collection variant | `lightCollection` — skips `reactiveScored`, uses FIFO/LRU. For high-throughput paths where eviction quality < raw speed. | S |

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

### Phase 7.1: `ai/` Folder + Migration

> **Goal:** Create a dedicated `ai/` surface layer for all AI/LLM-specific higher-level
> primitives. Consolidate scattered AI patterns into one import path so H2 (and users)
> never need to reach into `raw/`, `core/`, `extra/`, or `utils/` for AI app development.
>
> **Depends on:** Phase 6 (memory maturation), Phase 7a-7e (adapters complete).
>
> **Tier:** 5 (ai) — the highest surface layer, above `patterns/`, `adapters/`, `compat/`.
> Can import from all lower tiers + `patterns/`, `adapters/`, `compat/`, `memory/`, `worker/`,
> `orchestrate/`, `messaging/`, `data/`.

#### 7.1-0: Migrate existing AI primitives to `ai/`

Move these from their current locations. Pre-1.0, no backward compat needed.

| Source | Primitive | New location |
|--------|-----------|-------------|
| `patterns/chatStream` | `chatStream` | `ai/chatStream` |
| `patterns/agentLoop` | `agentLoop` | `ai/agentLoop` |
| `patterns/toolCallState` | `toolCallState` | `ai/toolCallState` |
| `patterns/memoryStore` | `memoryStore` | `ai/memoryStore` |
| `patterns/hybridRoute` | `hybridRoute` | `ai/hybridRoute` |
| `adapters/llm` | `fromLLM` | `ai/fromLLM` |
| `utils/checkpoint` | `checkpoint` + `indexedDBAdapter` | re-exported from `ai/` |
| `utils/tokenTracker` | `tokenTracker` | re-exported from `ai/` |

#### 7.1-1 through 7.1-5: New `ai/` primitives for H2

| # | Primitive | What | Effort |
|---|-----------|------|--------|
| 7.1-1 | `docIndex` | FTS5 trigram search over pre-built wa-sqlite DB. `docIndex({ db: url })` → `{ search(query): Store<SearchResult[]>, loaded: Store<boolean> }`. Wraps wa-sqlite WASM. Read-only — DB built at VitePress build time. | M |
| 7.1-2 | `embeddingIndex` | In-browser semantic search. Loads small embedding model via Transformers.js (`all-MiniLM-L6-v2`, ~23MB). `embeddingIndex({ model, vectors: url })` → `{ search(query, k): Store<ScoredDoc[]> }`. Pre-computed embeddings shipped as binary. Lazy-loaded alongside LLM (Tier 2). | L |
| 7.1-3 | `ragPipeline` | `ragPipeline({ docSearch, semanticSearch?, memory?, systemPrompt })` — wires retrieve→augment→generate. Reactive: re-derives context when any source updates. Merges FTS5 + embedding results, deduplicates, injects into LLM prompt with citations. Composes `docIndex` + `embeddingIndex` + `fromLLM` + `memoryStore`. | M |
| 7.1-4 | `conversationSummary` | Auto-summarize conversation when token count exceeds threshold. Uses the loaded LLM to compress history into a rolling summary. `conversationSummary({ chat, llm, maxTokens })` → `Store<string>`. Feeds into `ragPipeline` as context. | M |
| 7.1-5 | `systemPromptBuilder` | `systemPromptBuilder({ sections: Array<{ name, content: Store<string>, maxTokens? }> })` — reactive derived that assembles final system prompt from multiple sources. Manages token budget allocation across sections (library docs, user memories, search results, rules). | S |

#### 7.1-6: Build-time doc indexing script

`scripts/build-doc-index.mjs` — runs during VitePress build (`site` workspace).

**Input sources:**
- `llms-full.txt` — full API reference, split by `##` headings into chunks
- `examples/*.ts` — each file = one chunk, tagged with filename
- `site/recipes/*.md` — each recipe page, stripped of VitePress frontmatter
- JSDoc extracted from `src/ai/`, `src/patterns/`, `src/adapters/`, `src/orchestrate/`,
  `src/memory/` via a lightweight regex extractor (no need for TypeDoc)

**Processing pipeline:**
1. Parse each source into chunks: `{ id, title, body, tags[], source }`
2. Create wa-sqlite DB in memory
3. Create FTS5 virtual table: `CREATE VIRTUAL TABLE docs USING fts5(title, body, tags, source, tokenize='trigram')`
4. Insert all chunks
5. Write `.db` file to `site/.vitepress/public/docs-index.db` (~200KB expected)
6. Optionally: run embedding model (Node.js `@huggingface/transformers`) on each chunk body,
   write float32 vectors to `site/.vitepress/public/docs-embeddings.bin` + JSON manifest

**FTS5 query API** (what `docIndex` wraps at runtime):
```sql
SELECT id, title, snippet(docs, 1, '<mark>', '</mark>', '…', 32) as excerpt,
       rank, source, tags
FROM docs WHERE docs MATCH ? ORDER BY rank LIMIT 10
```

#### 7.1 dependency hierarchy update

```
Tier 4 (surface)   patterns/    adapters/    compat/
                        ↓            ↓           ↓
Tier 5 (ai)        ai/
```

`ai/` is the highest surface layer — it can import from everything. Nothing imports from `ai/`.

### Phase H2: AI Docs Assistant

> **Goal:** Showcase callbag-recharge building an edge-first AI documentation assistant.
> The assistant runs entirely in the browser — no API key, no data exfiltration,
> privacy by default. Demonstrates: reactive LLM streaming, cross-thread stores,
> persistent memory, search, and the full `ai/` surface layer.
>
> **Depends on:** Phase 7.1 (`ai/` folder with all primitives).
>
> **Constraint:** H2 store code uses **only** `ai/`, `compat/`, `data/`, `orchestrate/`,
> `memory/`, `worker/`, `messaging/` imports. Never `raw/`, `core/`, `extra/`, `utils/`
> directly. This makes the source code instructive for other developers.
>
> **Model:** Qwen3 via WebLLM (WebGPU). Default: Qwen3-1.7B-q4f16 (~1GB).
> Lite: Qwen3-0.6B (~400MB). Power: Qwen3-4B (~2.5GB). User picks in settings.
> Gemma 3 blocked in WebLLM (sliding-window bug, open >1yr). Qwen 3.5 not yet compiled.

#### Progressive loading tiers

```
Tier 1: "search" (page load, ~200KB wa-sqlite WASM + .db)
  └─ Search box → instant FTS5 trigram results → doc cards with excerpts
  └─ No LLM, no model download, no WebGPU needed
  └─ Works on any device, any browser

Tier 2: "ai" (user clicks "Enable AI" or asks a natural-language question)
  └─ Web Worker: download Qwen3-1.7B via WebLLM, cached by Service Worker
  └─ embeddingIndex loads (~23MB model + pre-computed vectors)
  └─ NL questions → hybrid search (FTS5 + semantic) → ragPipeline → streamed answer
  └─ conversationSummary manages 4-8K context window
  └─ System prompt from systemPromptBuilder: llms-full.txt chunks + search results

Tier 3: "memory" (activates after first session or user opts in)
  └─ SharedWorker: memoryStore + IndexedDB via workerBridge, cross-tab
  └─ Remembers: user's framework (React/Vue/Svelte), project type, past questions
  └─ System prompt enriched with user memories via systemPromptBuilder
  └─ decay scoring surfaces most relevant memories per query
```

#### Build phases

| # | Phase | What | Effort |
|---|-------|------|--------|
| H2-1 | **FTS5 search UI** | Build-time indexing script + `docIndex` + Vue chat component with search-only mode. Search box, doc cards with highlighted excerpts, category filters. No LLM. | M |
| H2-2 | **WebLLM + RAG** | Web Worker with WebLLM (Qwen3). `ragPipeline` wires search → augment → generate. `embeddingIndex` for semantic search. `conversationSummary` for context management. `systemPromptBuilder` injects llms-full.txt. Token streaming UI, cancel/retry, model selector. Service Worker caches model weights. | L |
| H2-3 | **Memory layer** | SharedWorker with `memoryStore` + IndexedDB via `workerBridge`. Auto-extracts user context from conversation. Cross-tab persistence. `systemPromptBuilder` section for memories. Memory indicator in UI. | L |
| H2-4 | **Polish** | Progressive loading UX (tier transitions), token usage meter (`tokenTracker`), WebGPU capability detection, graceful fallback for unsupported browsers, model download progress, settings panel (model choice, memory clear). | M |

#### LLM system prompt strategy

```
You are a callbag-recharge integration assistant.

RULES:
- Recommend ONLY high-level primitives from ai/, orchestrate/, memory/, data/, worker/
- Do NOT suggest raw/, core/, extra/, utils/ unless the user explicitly needs low-level control
- Always cite the specific function name and import path
- When showing code examples, use the ai/ surface API

LIBRARY DOCS:
{chunks from llms-full.txt, selected by ragPipeline based on query relevance}

USER CONTEXT:
{memories from memoryStore, selected by decay scoring — e.g. "uses React", "building a dashboard"}

SEARCH RESULTS:
{FTS5 + embedding search results with excerpts}
```

#### What H2 showcases about callbag-recharge

| Library feature | How H2 demonstrates it |
|---|---|
| `ai/chatStream` | Conversation management, streaming, cancel/retry |
| `ai/fromLLM` | WebLLM adapter via worker, unified streaming interface |
| `ai/ragPipeline` | Full retrieve→augment→generate orchestration |
| `ai/docIndex` | FTS5 trigram search over library docs |
| `ai/embeddingIndex` | In-browser semantic search with pre-computed vectors |
| `ai/conversationSummary` | Context window management for small models |
| `ai/systemPromptBuilder` | Reactive multi-source prompt assembly |
| `ai/memoryStore` | Three-tier session/working/long-term user memory |
| `worker/workerBridge` | Cross-thread reactive stores (3 workers) |
| `memory/collection` + `decay` | Relevance-scored persistent user context |
| `data/reactiveLog` | Conversation history |
| `ai/checkpoint` (re-exported) | Session persistence |
| `ai/tokenTracker` (re-exported) | Real-time token usage |
| `compat/vue` | `useStore`, `useSubscribe`, `useSubscribeRecord` |

#### Post-H2 extensions (deferred)

These require API keys or external services — not zero-config. Planned as opt-in add-ons.

| # | Extension | What | Why deferred |
|---|-----------|------|-------------|
| H2-ext-1 | **Web search** | `ai/webSearch` — Brave Search API adapter via Web Worker + `workerBridge`. `webSearch({ apiKey })` → `{ search(query): Store<WebResult[]> }`. Injected into `ragPipeline` as additional search source. | Requires user's Brave Search API key |
| H2-ext-2 | **Tool calling** | JSON-mode tool dispatch via `ai/toolCallState`. LLM outputs structured JSON (XGrammar-constrained), app executes tool, result feeds back. Tools: doc search, web search, memory recall. | Depends on H2-ext-1; WebLLM function calling broken on small models, JSON-mode workaround needs careful UX |
| H2-ext-3 | **Cloud fallback** | `ai/hybridRoute` routes complex questions to cloud API (user provides key). Auto-detect query complexity or user toggle. | Requires cloud API key, breaks "no API key" promise of base H2 |

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
