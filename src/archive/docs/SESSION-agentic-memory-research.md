---
SESSION: agentic-memory-research
DATE: March 17, 2026
TOPIC: SOTA Agentic Memory Research + AI Tool Full-Chain Analysis (全链路)
---

## KEY DISCUSSION

### Goal
Research state-of-the-art agentic memory systems and all major AI tool surfaces (web chat, CLI, desktop agents) to identify common patterns, pain points, and how callbag-recharge can tackle them as a unified reactive state management layer for AI memory — targeting performance that beats Redis.

---

## PART 1: SOTA AGENTIC MEMORY (March 2026)

### Leading Architectures

| System | Key Innovation | Memory Model |
|--------|---------------|--------------|
| **Letta (MemGPT)** | Self-editing memory via tool calls | Core (in-context) + Recall (conversational) + Archival (long-term) |
| **Mem0 / Mem0g** | Hybrid vector + incremental graph | Two-phase extraction pipeline; 91% p95 latency reduction vs full-history |
| **Zep/Graphiti** | Temporal knowledge graphs | Neo4j-backed; tracks fact evolution over time; slow graph construction |
| **Cognee** | Dual-index (every graph node has embedding) | Knowledge graph + vector store duality |
| **LangGraph** | Explicit graph state with reducer functions | Procedural (AGENTS.md) + Semantic (skill files) + Thread memory |
| **MemOS** | Memory as first-class OS resource | MemCube abstraction; activation/working/archival tiers |
| **MAGMA** | Four parallel graphs per memory item | Semantic + temporal + causal + entity; intent-adaptive retrieval |
| **A-Mem** | Zettelkasten-style atomic notes | Agent-driven linking; memory evolution triggers historical updates |

### Memory Types (CoALA Taxonomy — universally adopted)

- **Working Memory:** Active scratchpad (context window contents). Every framework implements as conversation buffer + system prompt.
- **Episodic Memory:** Records of specific experiences. Implementations: Generative Agents (recency × importance × relevance scoring), A-Mem (atomic notes with links), REMem (multi-hop reasoning over past experiences).
- **Semantic Memory:** Factual knowledge, entity relationships. Implementations: knowledge graphs (Cognee, Zep, Mem0g), vector stores (Mem0, LangChain), structured databases.
- **Procedural Memory:** Learned workflows, tool usage patterns. Implementations: AGENTS.md files, CodeMem (MCP-stored code snippets), Letta Code (skill learning from execution).

### Key Papers (2025-2026)

1. **"Memory in the Age of AI Agents: A Survey"** (Hu et al., Dec 2025) — 102-page definitive survey. Unified taxonomy: forms, operations (Consolidation, Updating, Indexing, Forgetting, Retrieval, Condensation), and dynamics.
2. **"Rethinking Memory in LLM-based Agents"** (May 2025) — Six core operations framework.
3. **"Graph-based Agent Memory: Taxonomy, Techniques, and Applications"** (Feb 2026) — Graph-based approaches survey.
4. **MAGMA** (Jiang et al., Jan 2026) — Four-graph model, outperforms SOTA on LoCoMo and LongMemEval.
5. **A-Mem** (Feb 2025) — Zettelkasten-style with agent-driven linking.
6. **FadeMem** (Wei et al., Jan 2026, ICASSP 2026) — Biologically-inspired dual-layer memory with adaptive exponential decay.
7. **"Forgetful but Faithful"** (Dec 2025) — Memory governance, right-to-be-forgotten compliance.
8. **"Procedural Memory Is Not All You Need"** (May 2025) — LLMs need semantic + associative memory, not just parametric.
9. **Task Memory Engine (TME)** (Apr 2025) — Task Memory Tree with parent-child step relationships.
10. **MemOS Paper** (Jul 2025) — MemCube abstraction with lifecycle management.

### Critical Gap: No Reactive Memory

**No existing agent memory system uses reactive/push-based state management.** All are pull-based (query → retrieve → return). Push-based dirty tracking + incremental computation via callbag-recharge is a genuinely novel contribution.

### Performance: Why In-Process Beats Redis

| Access Pattern | Latency | vs Redis localhost |
|---|---|---|
| In-process `state.get()` | ~10 ns | **10,000x faster** |
| callbag signal propagation | ~10-100 ns | **1,000x faster** |
| In-process HNSW vector search | ~1-10 μs | **10-100x faster** |
| Redis localhost (TCP) | ~50-500 μs | baseline |

The network hop is the bottleneck. In-process reactive stores eliminate serialization, deserialization, and TCP overhead entirely.

### Memory Consolidation & Forgetting

- **FadeMem:** Dual-layer (hot + cold), adaptive exponential decay modulated by relevance, frequency, temporal patterns.
- **Generative Agents pattern:** `score = α×recency + β×importance + γ×relevance`
- **Consolidation:** Local (dedup), Cluster (summarize groups), Global (periodic reorg).
- **Admission control:** Not everything should become a memory. Category > Novelty > Utility > Confidence > Recency.

---

## PART 2: AI TOOL FULL-CHAIN ANALYSIS (全链路)

### Tools Researched

**Web Chat:** OpenAI ChatGPT, Claude.ai, Google Gemini, Grok, Perplexity
**CLI:** Claude Code, OpenCode, Aider, Codex CLI, Goose, Amp, Gemini CLI, Crush, Warp
**Desktop/Cloud Agents:** Manus, Cowork, Devin, Replit Agent, OpenClaw
**Extensions:** Cline, Continue.dev, Cursor, Windsurf, Kilo

### Cross-Tool Communication Patterns

| Surface | Protocol | Pattern |
|---------|----------|---------|
| Web chat | **SSE** (100%) | Token streaming, `data:` prefixed JSON chunks |
| CLI tools | **Direct API → SSE** | Streaming to terminal via async iterators |
| Desktop agents | **WebSocket** | Real-time bidirectional (sandbox ↔ UI) |
| Computer use | **HTTP request-response** | Screenshot → action → screenshot loop |
| Voice/realtime | **WebSocket / WebRTC** | OpenAI Realtime, Gemini Live |

**Pain point:** SSE is unidirectional. Platforms needing user interruption or tool approval bolt on WebSocket. No unified reactive transport.

### Universal Agent Loop

Every agent runs: Observe → Plan → Act → Reflect. State between iterations is ad-hoc (Manus: `todo.md`, Claude Code: in-memory + compaction, LangGraph: state dict with checkpointers). **Nobody has a reactive state graph driving the loop.**

### Cross-Tool Session Persistence

| Tool | Storage | Cross-Session |
|------|---------|---------------|
| Claude Code | In-memory + resumable | CLAUDE.md + auto-memory files |
| OpenCode | HTTP server state + session IDs | Config files |
| Aider | In-memory (ephemeral) | None built-in |
| Codex CLI | In-memory + resume flag | Agent Skills files |
| Cline | VS Code state + filesystem backups | Memory Bank (markdown) |
| Goose | Per-session in Rust core | .goosehints + TODO extension |

### Context Management Strategies

1. **Agentic search** (Claude Code, OpenCode, Codex): Model uses grep/glob tools dynamically.
2. **Repository map + PageRank** (Aider): Tree-sitter AST → graph ranking.
3. **File scoring** (Cline): Multi-factor (recency, frequency, type).
4. **Compaction/summarization** (Claude Code, OpenClaw, LangGraph): LLM summarizes old context when budget exceeded.

### Tool Execution Patterns

- **Function calling** (Claude Code, OpenCode, Codex, Goose): Standard LLM tool-calling APIs.
- **XML tool calling** (Cline): Enables models without native function calling.
- **Structured edit formats** (Aider): LLM outputs diffs/search-replace blocks.
- **MCP-first** (Goose): All extensibility through MCP protocol.

### Safety / Permission Models

- **Tiered approval** (Claude Code, OpenCode): Auto-approve reads, require approval for writes/commands.
- **Human-in-the-loop** (Cline): Every action requires explicit approval.
- **Shadow git versioning** (Cline, Claude Code): Git checkpoints for safe rollback.
- **Sandbox execution** (Codex CLI): Configurable sandbox policies.

### Multi-Agent Coordination

- **Git worktrees** (emerging standard): Each agent gets isolated worktree.
- **Plan/Execute separation**: Powerful models plan, faster models execute (Aider Architect, Claude Code, Amp Oracle).
- **Hierarchical orchestration** (Cursor): Planners → Workers → Judges.

---

## PART 3: THE 5 BIGGEST PAIN POINTS (Our Targets)

### Pain 1: Context Assembly is O(n) Every Turn
Every agent rebuilds entire context window from scratch each turn. `derived()` caches assembled context — only recomputes when a dependency changes. **Turn-2+ drops from O(n) to O(1) for unchanged deps.**

### Pain 2: No Diamond-Safe Coordination
New message should trigger: memory retrieval + context update + token counting + persistence — all exactly once, in right order. Current: imperative sequencing. Two-phase push (DIRTY → values) solves automatically.

### Pain 3: No Cancellation Composition
Context changes mid-LLM-call → in-flight call should cancel. Current: manual `AbortController`. Ours: `switchMap` auto-cancels previous.

### Pain 4: No Observability Into State Graph
No tool shows: why did context recompute? which dep changed? what's the current token count? `Inspector.snapshot()` shows all of this.

### Pain 5: Memory is Passive, Not Reactive
Memories are stored and retrieved but don't trigger downstream effects. A preference change doesn't invalidate cached contexts. `effect()` + `derived()` chains make memory active.

---

## PART 4: ARCHITECTURE DECISIONS

### Job Queue / Kafka: NOT NEEDED

Stay lightweight. All agent patterns map to callbag primitives:

| Pattern | callbag-recharge Answer |
|---------|------------------------|
| Agent internal state graph | `state()` → `derived()` → `effect()` |
| Streaming LLM output | `producer()` + `scan()` |
| Tool call orchestration | `switchMap` / `concatMap` |
| Memory write-behind | `effect()` with debounce |
| Multi-agent (same process) | Shared `state()` stores |
| Background embedding | `producer()` async |

Kafka only appears at enterprise scale for audit/replay. Phase 6+, not now.

### Cross-Process Communication: NOT a Node.js Limitation

Two separate OS processes cannot share memory — this is true for any language. Bridge options:

| Bridge | Latency | When |
|--------|---------|------|
| **SharedArrayBuffer** (worker threads) | ~100ns | Same Node.js process |
| **Unix domain socket** | ~5-10μs | Same machine, no durability |
| **TCP/WebSocket** | ~50-100μs | Same/different machine |
| **Redis Streams** | ~100-500μs | Need durability + replay |
| **Kafka** | ~1-5ms | Enterprise audit |

The actual transport is pluggable — just a `producer()` (inbound) + `effect()` (outbound) pair at the graph edge. Redis Streams is one option, not a requirement.

### Session Management: Lightweight Reactive

```ts
const session = sessionStore({
  id: sessionId,
  messages: state<Message[]>([]),
  toolResults: state<ToolResult[]>([]),
  context: derived([messages, toolResults, longTermMemory], assembleContext),
  persist: effect([messages, toolResults], () => adapter.save(sessionId, ...)),
})
// Resume = rehydrate state() stores; derived graph recomputes automatically
```

Works identically for web chat (SSE sink), CLI (terminal sink), desktop (WebSocket sink).

### RBAC: Layer on Top, Not in Core

Capability-based access wrapper around stores. RBAC is policy, not a reactive primitive. Follows MCP Gateway pattern (Acorn, Lasso).

### Extensibility Guarantee: No Lock-In

callbag protocol makes sources and sinks interchangeable:
- Swap `state()` for `producer(ws)` → graph untouched
- Swap `effect(writeToMemory)` for `effect(writeToPostgres)` → graph untouched
- The graph topology and all derived computation stay identical regardless of transport

---

## PART 5: PHASED PLAN

| Phase | Deliverable | Serves | Effort |
|-------|-------------|--------|--------|
| **0** | Reactive KV Store | All tools (universal state primitive) | ~2-3 days |
| **1** | Memory Primitives (MemoryNode, Collection, Decay) | All agent memory | ~3-4 days |
| **2** | In-process Vector Index | Semantic search without network hop | ~3-4 days |
| **3** | `memoryStore` pattern (3-layer) | The product — AI memory state management | ~2-3 days |
| **3.5** | Session transport adapters | SSE, WebSocket, HTTP sinks | ~1-2 days |
| **4** | Knowledge Graph (reactive) | Entity relationships, MAGMA-style multi-view | ~4-5 days |
| **4.5** | RBAC wrapper + audit `effect()` | Enterprise, multi-tenant, GDPR | ~2-3 days |
| **5** | Consolidation + self-editing | Memory lifecycle management | ~3-4 days |
| **5.5** | Persistence adapters | SQLite, Postgres, Redis via `effect()` | ~2-3 days |
| **6** | Multi-agent + distribution | Cross-process via pluggable bridge | ~5+ days |

### Benchmark Targets

| Operation | Redis | Our Target | Speedup |
|---|---|---|---|
| Point read | 100μs | 10ns | 10,000x |
| Point write | 100μs | 50ns | 2,000x |
| Vector search (k=10, 10K items) | 500μs | 5μs | 100x |
| Derived view read (cached) | N/A | 10ns | ∞ |
| Batch update (10 keys) | 1ms | 200ns | 5,000x |

---

## KEY INSIGHTS

1. **No existing agent memory system uses reactive state management.** 100% pull-based. Push-based dirty tracking is a genuinely novel contribution.

2. **Context assembly is the #1 performance bottleneck** across all AI tools. It's pure derived computation that could be cached and incrementally updated.

3. **The callbag protocol is transport-agnostic.** Sources and sinks are leaf nodes. The graph doesn't care if upstream is a button click, WebSocket message, or Kafka consumer. This enables 全链路 — same reactive core, different edges per surface.

4. **Cross-process communication is a physics problem, not a runtime limitation.** Any bridge (socket, Redis, shared memory) plugs in as `producer()` + `effect()` at the graph edge.

5. **RBAC, persistence, and transport are policy concerns** that layer on top of the reactive core. They don't belong in `state()` / `derived()` / `effect()`.

6. **Job queues and Kafka are NOT needed** for agent memory. callbag primitives replace in-process message passing entirely. External queues are only for cross-machine durability.

## OPTIMIZATION UPDATE (March 17, 2026)

### Benchmark Reality Check

After migrating to Vitest/tinybench (statistical sampling, more realistic than tight for-loops), Level 3 data structures benchmarked well:

| Data Structure | vs Native | Assessment |
|---|---|---|
| reactiveMap (set+get) | 1.56x | Excellent — 64% native with full reactivity |
| reactiveLog (append) | 2.51x | Good — includes reactive version + event overhead |
| reactiveLog (bounded) | 2.54x | Good — fixed from 10.8x via circular buffer |
| reactiveIndex (select read) | 1.01x | Native speed — zero overhead on reads |
| **collection (50 adds + tag read)** | **29.4x** | Bottleneck — per-node reactive stores + eviction |
| reactiveScored (evict+reinsert) | 19.6x | Primary collection bottleneck |

### Optimizations Applied

1. **Integer `_status` in `_flags`** — core hot-path: string → integer bitwise ops
2. **Circular buffer for bounded reactiveLog** — O(1) append replacing O(n) splice
3. **Version-gated collection stores** — lazy derived materialization replacing eager state arrays
4. **Simplified node ID** — removed Date.now() from memoryNode ID generation

### Impact on Agentic Memory Use Case

The Level 3 data primitives (reactiveMap, reactiveLog, reactiveIndex) are **validated as near-native** — suitable for the "10ns read" target from the original research. The `collection` primitive (which wraps memoryNode + reactiveIndex + reactiveScored) is slower due to stacking multiple reactive layers per node.

**Recommendation for collection-heavy workloads:** If sub-microsecond collection operations are needed, consider a lightweight collection variant that skips reactive eviction (reactiveScored) and uses simple FIFO or manual eviction. The current collection design prioritizes reactive score tracking (push-based decay + importance scoring) over raw throughput — this is the right default for agentic memory where scores drive retrieval quality, but a "slim" variant could serve high-throughput scenarios.

## FILES CHANGED

- This file created: `src/archive/docs/SESSION-agentic-memory-research.md`

---END SESSION---
