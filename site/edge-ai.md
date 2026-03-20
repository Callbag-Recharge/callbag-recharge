---
outline: deep
---

# State Management for Edge AI

The reactive layer between your LLM and your app — for browser inference, local models, and hybrid cloud+edge routing.

---

## The Gap

Edge/local LLM inference is production-ready:

- **WebGPU** across all major browsers
- **Ollama** as the de facto local inference standard
- **ExecuTorch 1.0** on mobile (19.92 tok/s on Llama 4 Scout)
- **Apple Foundation Models** framework for on-device

But **no reactive library exists for LLM streaming/orchestration**. The gap between the inference runtime and your app is filled with ad-hoc `useState` + `AbortController` + manual state management.

callbag-recharge fills this gap. Every primitive already exists — the library was designed for streaming state management from day one.

---

## How It Maps

| LLM Concept | callbag-recharge Primitive | Why |
|---|---|---|
| Token stream | `producer()` | Wraps any streaming API with cleanup |
| Conversation state | `state([])` | Writable store, framework-agnostic |
| Context window | `derived([history], fn)` | Computed token budget, always current |
| Auto-cancel on new prompt | `switchMap()` | Cancels previous inference automatically |
| Chunk accumulation | `scan((acc, token) => acc + token, '')` | Running fold over token stream |
| Rate limiting | `throttle(ms)` | Backpressure for fast token streams |
| Retry on failure | `retry(n)` | Model loading failures, OOM recovery |
| Cloud fallback | `rescue(() => cloudSource)` | Transparent error recovery |
| Complexity routing | `route(source, predicate)` | Split requests by complexity |
| Tool call lifecycle | `stateMachine()` | Typed FSM: request → execute → result |
| Agent loop | `dynamicDerived()` + `effect()` | Observe → Plan → Act with rewiring |
| Execution history | `executionLog()` | Reactive log of every step |
| Graph visualization | `Inspector.toMermaid()` | See the full agent graph |

---

## Token Streams as Reactive Sources

Every LLM streaming API becomes a callbag `producer`:

```ts
import { producer } from 'callbag-recharge'

// Ollama (HTTP streaming)
const ollamaTokens = producer<string>(({ emit, complete, error }) => {
  const ctrl = new AbortController()
  fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    body: JSON.stringify({ model: 'llama4', prompt, stream: true }),
    signal: ctrl.signal,
  }).then(async res => {
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      for (const line of decoder.decode(value, { stream: true }).split('\n').filter(Boolean)) {
        const chunk = JSON.parse(line)
        if (chunk.response) emit(chunk.response)
        if (chunk.done) { complete(); return }
      }
    }
    complete()
  }).catch(e => { if (e.name !== 'AbortError') error(e) })
  return () => ctrl.abort()
})

// WebLLM (browser inference)
const webllmTokens = producer<string>(({ emit, complete, error }) => {
  let engine: any
  ;(async () => {
    engine = await webllm.CreateMLCEngine('Llama-4-Scout-17B-16E-Instruct-q4f16_1-MLC')
    const stream = await engine.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    })
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content
      if (delta) emit(delta)
    }
    complete()
  })().catch(e => error(e))
  return () => engine?.interruptGenerate()
})
```

Once it's a `producer`, the full operator set applies:

```ts
const response = pipe(
  tokens,
  scan((acc, t) => acc + t, ''),  // accumulate
  // throttle(16),                 // 60fps UI updates
)

const tokenCount = derived([response], () => estimateTokens(response.get()))
const contextRemaining = derived([tokenCount], () => 4096 - tokenCount.get())
```

---

## Hybrid Routing

Route simple queries to local models, complex queries to cloud — with automatic fallback:

```ts
import { route } from 'callbag-recharge/orchestrate'
import { rescue } from 'callbag-recharge/extra'

const [simple, complex] = route(request, req => req.complexity !== 'complex')

// Local model with cloud fallback on failure
const localResult = pipe(simple, switchMap(localInfer), rescue(() => cloudInfer))

// Complex → cloud directly
const cloudResult = pipe(complex, switchMap(cloudInfer))

// Merge results
const result = merge(localResult, cloudResult)
```

Research shows hybrid routing reduces cloud costs by **60%** and latency by **40%**.

---

## Tool Calling as State Machine

The tool call lifecycle is a typed FSM:

```
idle → pending → executing → completed → idle
                           → error → idle
```

```ts
import { stateMachine } from 'callbag-recharge/utils'

const toolFSM = stateMachine(
  { status: 'idle' },
  {
    idle:      { REQUEST: (_, e) => ({ status: 'pending', call: e.call }) },
    pending:   { EXECUTE: (s) => ({ status: 'executing', call: s.call }) },
    executing: {
      COMPLETE: (s, e) => ({ status: 'completed', result: e.result }),
      ERROR:    (s, e) => ({ status: 'error', error: e.error }),
    },
    completed: { REQUEST: (_, e) => ({ status: 'pending', call: e.call }), RESET: () => ({ status: 'idle' }) },
    error:     { REQUEST: (_, e) => ({ status: 'pending', call: e.call }), RESET: () => ({ status: 'idle' }) },
  }
)

// Observable — subscribe to status changes
const isExecuting = derived([toolFSM.store], () => toolFSM.store.get().status === 'executing')
```

---

## Context Window as Derived Computation

Track token budget reactively — no manual bookkeeping:

```ts
const contextLimit = 4096
const systemTokens = 200

const history = state<Message[]>([])
const historyTokens = derived([history], () =>
  history.get().reduce((sum, msg) => sum + estimateTokens(msg.content), 0)
)
const available = derived([historyTokens], () => contextLimit - systemTokens - historyTokens.get())
const shouldTruncate = derived([available], () => available.get() < 100)

effect([shouldTruncate], () => {
  if (shouldTruncate.get()) {
    history.update(h => h.slice(-10)) // keep last 10 messages
  }
})
```

---

## Agent Memory

Reactive memory with decay-scored eviction — built-in:

```ts
import { memoryStore } from 'callbag-recharge/patterns/memoryStore'

const memory = memoryStore({ workingSize: 10, longTermSize: 100 })
memory.remember('User prefers TypeScript')
memory.focus('pref-1')     // promote to working memory
memory.recall(5)           // top-5 by score
memory.recallByTag('pref') // tag-based retrieval
```

---

## Target Use Cases

| Use Case | Key Primitives |
|---|---|
| Browser chatbot with local LLM | `producer` + `switchMap` + `scan` + `state` |
| Hybrid cloud/edge routing | `route` + `rescue` + `merge` |
| Tool calling for local models | `stateMachine` + `producer` + `effect` |
| Context window management | `derived` + `effect` for auto-truncation |
| Multi-model coordination | `state` stores + `switchMap` for model switching |
| Streaming structured output | `scan` + incremental parser + type extraction |
| Agent memory | `memoryStore` pattern or `collection` + `decay` |

---

## Recipes

- [On-Device LLM Streaming](/recipes/on-device-llm-streaming) — manage WebLLM/Ollama token streams
- [Hybrid Cloud+Edge Routing](/recipes/hybrid-routing) — confidence-based routing with fallback
- [Tool Calls for Local LLMs](/recipes/tool-calls) — reactive tool call lifecycle
- [AI Chat with Streaming](/recipes/ai-chat-streaming) — cloud LLM streaming pattern

## Comparisons

- [vs Vercel AI SDK](/comparisons/vercel-ai-sdk) — hooks vs reactive graph
- [vs LangGraph.js](/comparisons/langgraph) — state dicts vs reactive stores
