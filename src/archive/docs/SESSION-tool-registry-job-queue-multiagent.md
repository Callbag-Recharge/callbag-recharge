# SESSION: Tool Registry + Job Queue Integration + Multi-Agent Gap Analysis

**Date:** 2026-03-25
**Topic:** Designing `toolRegistry` primitive that bridges `toolCallState` → `jobQueue`, evaluating feasibility of building an OpenClaw-like multi-agent backend app with callbag-recharge

---

## Context

User asked two questions:
1. Can we integrate tool calls with the Pulsar-style job queue (Phase 5e) to make LLM more powerful in backend scenarios?
2. Can we build an OpenClaw-like multi-agent backend demo? What are the gaps?

---

## Key Discussion

### Tool Call + Job Queue Integration

Identified that the pieces are close to connecting but lacked a registry/dispatch layer:

- `toolCallState` manages a single tool call lifecycle (idle → pending → executing → completed)
- `jobQueue` provides durable job processing with concurrency, retry, stall detection, DLQ
- Missing: a `toolRegistry` that maps tool names → handlers/queues, validates args, dispatches calls, collects results

**Benefits of routing tool calls through jobQueues:**
1. Concurrency control — LLM requests N tool calls, queue caps at configurable limit
2. Retry + backoff — flaky external APIs get automatic retry
3. Stall detection — if a tool hangs, detected + cancelled/retried
4. DLQ — failed tool calls route to dead-letter for inspection
5. Observability — companion stores (`active`, `completed`, `failed`, `waiting`) for reactive dashboards
6. Multi-agent fan-out — `jobFlow` chains agent outputs: Agent A's tool results feed Agent B's queue

### OpenClaw-Like Multi-Agent Gap Analysis

**Already covered (solid):**
- Agent loop (observe/plan/act): `agentLoop`
- Human-in-the-loop: `gate`, `approval`
- Tool call lifecycle: `toolCallState`
- LLM streaming: `fromLLM`, `chatStream`
- Job execution with retry/DLQ: `jobQueue`, `jobFlow`
- Memory (vector + graph + decay): `collection`, `vectorIndex`, `knowledgeGraph`, `decay`
- RAG pipeline: `ragPipeline`, `docIndex`, `embeddingIndex`
- Workflow orchestration: `pipeline`, `task`, `forEach`, `branch`, `loop`
- Inter-agent messaging: `topic`, `subscription`, `pubsub`
- Diagram export: `toMermaid`, `toD2`

**Gaps identified:**

| # | Gap | What's missing | Effort |
|---|-----|----------------|--------|
| 1 | **Tool registry + dispatch** | Registry mapping tool names → job queues, arg validation, parallel dispatch, result collection | M |
| 2 | **Multi-agent routing** | Supervisor/agent pool dispatching tasks to specialized agents | M-L |
| 3 | **Structured output / function calling** | `fromLLM` doesn't parse OpenAI `tools`/`tool_calls` response format | M |
| 4 | **Conversation threading** | Per-agent conversation history with shared context | S-M |
| 5 | **Sandbox/code execution** | Adapter for Docker API / E2B / subprocess | M |
| 6 | **File system / workspace** | Reactive file watching + virtual FS | M |
| 7 | **Session persistence** | Full agent state checkpointing (queues, memory, conversation) | S-M |

### Architecture Sketch

```
                    ┌─────────────┐
                    │  Supervisor  │  (agentLoop + jobFlow router)
                    └──────┬──────┘
                           │ topic: "tasks"
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  Planner │ │  Coder   │ │ Reviewer │  (each an agentLoop + jobQueue)
        └────┬─────┘ └────┬─────┘ └────┬─────┘
             │             │             │
             ▼             ▼             ▼
        ┌──────────────────────────────────────┐
        │         Tool Registry (jobQueues)     │
        │  search | code_exec | file_rw | db   │
        └──────────────────────────────────────┘
                           │
                    ┌──────┴──────┐
                    │ Shared Memory│  (knowledgeGraph + collection + vectorIndex)
                    └─────────────┘
```

---

## Outcome: `toolRegistry` Implemented

**Location:** `src/ai/toolRegistry/index.ts` (Tier 5, ai/ surface layer)

### API Design

```ts
const registry = toolRegistry({
  tools: {
    search: {
      description: "Search the web",
      parameters: { type: "object", properties: { query: { type: "string" } } },
      handler: (signal, args) => searchAPI(signal, args.query),
    },
    deploy: {
      description: "Deploy service",
      handler: (signal, args) => deployService(signal, args),
      queue: { concurrency: 1, retry: { maxRetries: 3 }, stalledJobAction: "retry" },
      timeout: 120_000,
    },
  },
});
```

### Key Design Decisions

**Dual execution modes:**
- **Inline** (no `queue` option) — handler runs directly via `rawFromAny`, signal-first, optional timeout via `fromTimer`
- **Queue** (with `queue` option) — routes through `jobQueue` with concurrency, retry, stall detection, dead-letter

**`execute()` returns callbag source, not Promise:**
- Works directly in `agentLoop` act phase (rawFromAny in agentLoop handles callbag sources)
- Dispatches all calls in parallel, emits `ToolResult[]` when all settle
- One-shot producer pattern (same as agentLoop's gate source)

**`definitions()` returns OpenAI-compatible format:**
- `{ type: "function", function: { name, description, parameters } }[]`
- Pass directly to LLM's `tools` parameter

**Signal-first for handler callbacks:** `(signal, args)` per project conventions

**Schema validation:** Optional `.schema` field (Zod/Valibot/ArkType compatible `.parse()`)

### Bugs Fixed During Implementation

1. **Sync handler throws:** `rawFromAny(handler())` doesn't catch sync throws from the handler call itself. Fixed by wrapping handler invocation in try/catch before passing to rawFromAny.
2. **Empty array via rawFromAny:** `rawFromAny([])` iterates the empty array (Iterable path), emitting zero DATA events. Fixed by using one-shot producer for the empty-calls case.

### Reactive Stores

- `active: Store<number>` — currently executing count
- `history: Store<ToolResult[]>` — bounded history (configurable maxHistory)
- `lastResults: Store<ToolResult[]>` — results from last `execute()` batch

### Test Coverage

15 tests covering: creation, definitions format, inline dispatch (sync/async), unknown tool handling, handler error, schema validation, parallel execute, empty calls, ctx passthrough, mixed success/failure, queue mode, active tracking, history bounding, destroy behavior.

---

## Rejected Alternatives

- **Returning Promise from `execute()`** — breaks callbag-native output principle (§1.20). Callbag source works with rawFromAny in agentLoop.
- **Wrapping `toolCallState` internally** — toolCallState is a single-call state machine; toolRegistry manages N tools with N potential queues. Different concerns.
- **setTimeout for timeout** — uses `fromTimer` + AbortSignal chain per §1.18 (no setTimeout for reactive coordination).
- **Building multi-agent routing in this session** — gap #2 is M-L effort, better as a separate primitive (`agentPool` or `supervisor`) once toolRegistry is validated.

---

## Key Insight

The combination of `toolRegistry` + `jobQueue` + `agentLoop` creates a natural backend agent pattern:
- LLM decides which tools to call (plan phase)
- Registry validates and dispatches to the right queue (act phase)
- Each queue handles its own retry/stall/DLQ semantics
- Results flow back reactively to the agent loop
- Multiple agents share tools via the same registry + shared memory via knowledgeGraph

This is architecturally simpler than LangGraph/CrewAI because the reactive graph IS the orchestration engine — no separate DAG scheduler needed.

---

## Files Changed

- `src/ai/toolRegistry/index.ts` — new primitive (toolRegistry)
- `src/ai/index.ts` — barrel export for toolRegistry types + function
- `src/__tests__/ai/toolRegistry/index.test.ts` — 15 tests

---

## Next Steps (not yet implemented)

1. **Gap #3: Extend `fromLLM` for structured output** — parse `tool_calls` from SSE chunks, feed into toolRegistry
2. **Gap #2: `agentPool` or `supervisor`** — multi-agent routing via topic + jobFlow
3. **Backend demo** — minimal 2-agent system (planner + executor) wired via jobFlow with shared knowledgeGraph

---

## Session 2 (March 25): Four Standalone Products Architecture

### Context

User asked: "How far are we from building an out-of-the-box agentic memory tool like Mem0?" Discussion expanded to four standalone products ordered by dependency chain.

### Four Products (Dependency Chain)

```
orchestrate/ → messaging/ (topic/sub) → messaging/ (jobQueue) → ai/ (agentMemory)
```

1. **Orchestration Engine** — polish existing 21-module orchestrate/ into standalone workflow engine
2. **Messaging Bus** — topic/subscription as standalone message bus with distribution (topic bridge)
3. **Job Queue** — durable job processing as standalone product with progress, priority, scheduling
4. **agentMemory** — Mem0-equivalent reactive agentic memory composing products 2 & 3

### Architecture Decisions

#### agentMemory uses jobQueue internally

Current v1 uses inline `llm.generate()` + `subscribe(llm.status)` for extraction. Target: route through jobQueue for retry, stall detection, DLQ.

```
agentMemory(opts) {
  extractionQueue = jobQueue("mem:extract", extractionProcessor, opts.extraction)
  embeddingQueue = jobQueue("mem:embed", embeddingProcessor, opts.embedding)

  add(messages, scope?) {
    extractionQueue.add({ messages, scope })
    // processor: llm.generate() + parseFacts()
    // on complete: embeddingQueue.add() per fact
    // embedding processor: embed() + checkDedup + store/update
  }
}
```

- Extraction queue: concurrency 1 (LLM is sequential)
- Embedding queue: concurrency N (parallel embedding)

#### Topic-based multi-agent coordination

Not transport-based. Single-process: shared agentMemory instance with scope tags. Distributed: topic bridge with transport adapters.

```
Process A                          Process B
┌──────────────┐                  ┌──────────────┐
│  topic("x")  │ ──bridge──────→ │  topic("x")  │
│              │ ←──bridge────── │              │
└──────────────┘                  └──────────────┘
```

**topicBridge** is a new primitive in messaging/:
- Subscribes to local topic → sends to remote via transport
- Receives from remote → publishes to local topic
- Dedup via message ID to prevent echo loops

**Transport adapters under messaging/** (separate from memory/'s transports):
- `wsMessageTransport(ws)` — WebSocket (browser + Node)
- `h2MessageTransport(opts)` — HTTP/2 bidirectional stream (Node only)
- `unixMessageTransport(path)` — Unix domain socket (Node only)

#### §1.14 compliance: `inner` property

`collection` and `vectorIndex` moved behind `.inner`:
```ts
mem.inner.collection      // Collection<string>
mem.inner.vectorIndex     // VectorIndex
mem.inner.extractionQueue // JobQueue (future: for monitoring)
mem.inner.embeddingQueue  // JobQueue (future: for monitoring)
```

#### Distributed job queue via topic bridge

Producer adds to local topic. Bridge replicates to worker process. Worker's subscription pulls and processes. Results flow back via bridge.

### Messaging Distribution Gaps

| Gap | Effort |
|-----|--------|
| Topic bridge (bidirectional sync with dedup) | M |
| Transport adapters (ws, h2, unix) | M per adapter |
| Message filtering on subscription | S |
| Consumer lag metric (time-based) | S |
| TTL / retention policy | S |
| Admin API (listTopics, inspectSubscription) | S-M |
| Backpressure signaling to producers | S |

### Job Queue Standalone Gaps

| Gap | Effort |
|-----|--------|
| Job progress callback + store | S-M |
| Priority ordering in pull | S-M |
| Scheduled jobs (runAt) | S |
| Job removal + introspection | S-M |
| Batch add | S |
| Rate limiting | S-M |
| Distribution via topic bridge | M |
| Job state persistence | M |

### Orchestration Polish Gaps

| Gap | Effort |
|-----|--------|
| Pipeline timeout (global) | S |
| N-way switch step | S-M |
| Per-step metrics stores | S |
| Pause/resume pipeline | S-M |
| Admin introspection (pipeline.inspect()) | S |
| Backoff preset integration in task retry | S |

### agentMemory v1 → v2 Path

**v1 (current, shipped):** Inline LLM extraction + embedding. collection/vectorIndex under `inner`. Scope-based isolation. Persistence via checkpoint adapter.

**v2 (future):** jobQueue for extraction + embedding. Memory event topic for cross-agent broadcasting. Graph extraction via knowledgeGraph. Shared memory via topic bridge.

### Key Insight

The four products share infrastructure:
- Orchestration provides the DAG engine (pipeline, task, retry, stall detection)
- Messaging provides the event bus (topic, subscription, consumer modes)
- Job queue provides durable processing (built on messaging primitives)
- agentMemory composes all three: extraction jobs, embedding jobs, memory event broadcasting

This is architecturally simpler than building each product independently. The reactive graph IS the coordination mechanism.

### Files Changed

- `src/ai/agentMemory/` — new module (5 files): index.ts, types.ts, extraction.ts, dedup.ts, persistence.ts
- `src/ai/systemPromptBuilder/index.ts` — shipped (7.1-5)
- `src/__tests__/ai/agentMemory/` — 4 test files
- `src/__tests__/ai/systemPromptBuilder/index.test.ts` — 12 tests
- `src/ai/index.ts` — barrel exports for agentMemory + systemPromptBuilder
