---
outline: deep
---

# callbag-recharge vs LangGraph.js

Both orchestrate AI agent workflows with graph semantics. callbag-recharge uses reactive stores and callbag protocol; LangGraph uses state dictionaries and channel-based message passing.

## At a Glance

| Feature | LangGraph.js | callbag-recharge |
|---------|-------------|-----------------|
| **State model** | State dict (`Record<string, any>`) | Reactive stores (`.get()/.set()`) |
| **Graph edges** | Explicit `addEdge()` / `addConditionalEdge()` | `derived()` deps, `route()`, `dynamicDerived()` |
| **Conditional branching** | `addConditionalEdge(fn)` | `route(source, pred)`, `dynamicDerived(get => ...)` |
| **Cycles** | `END` sentinel to break loops | `effect()` → `set()` natural cycles |
| **Human-in-the-loop** | `interrupt()` with checkpoint | `gate()` — reactive approve/reject/modify |
| **Persistence** | Checkpoint (memory, SQLite) | `checkpoint()` — memory, file, SQLite, IndexedDB |
| **Streaming** | `.stream()` on graph | Native — every store is a stream |
| **Observability** | LangSmith (paid) | `Inspector` (free, built-in) |
| **Diamond resolution** | Not applicable | Glitch-free two-phase push |
| **Framework** | LangChain ecosystem | Standalone (no ecosystem lock-in) |
| **Bundle size** | ~100 KB+ (with LangChain deps) | ~4.5 KB core |

## The Key Difference

LangGraph models agent state as a mutable dictionary passed between nodes. callbag-recharge models agent state as reactive stores with automatic dependency tracking, diamond resolution, and push-based updates.

```ts
// LangGraph.js
const graph = new StateGraph({ channels: { messages: { value: [] } } })
graph.addNode('agent', agentNode)
graph.addNode('tools', toolNode)
graph.addConditionalEdge('agent', shouldContinue, { continue: 'tools', end: END })
graph.addEdge('tools', 'agent')

// callbag-recharge
const messages = state<Message[]>([])
const phase = state<'agent' | 'tools' | 'done'>('agent')

const agentOutput = dynamicDerived((get) => {
  if (get(phase) === 'agent') return runAgent(get(messages))
  return null
})

effect([agentOutput], () => {
  const output = agentOutput.get()
  if (output?.toolCalls.length) phase.set('tools')
  else phase.set('done')
})
```

## What LangGraph Lacks

### 1. Reactive state

LangGraph state is a dictionary snapshot — no subscriptions, no derived values, no automatic propagation. You must manually wire state between nodes.

### 2. Diamond resolution

When multiple LangGraph nodes converge, there's no guarantee of consistent state. callbag-recharge's two-phase push ensures convergence points see correct values.

### 3. Built-in streaming operators

LangGraph's `.stream()` is output-only. callbag-recharge's stores ARE streams — compose with `switchMap`, `debounce`, `retry`, `scan`, etc.

### 4. Free observability

LangGraph's observability requires LangSmith (paid SaaS). callbag-recharge's `Inspector` is free, built-in, and runs anywhere.

### 5. Framework independence

LangGraph is part of the LangChain ecosystem. callbag-recharge has zero dependencies and no ecosystem lock-in.

## What LangGraph Does Better

- **LangChain integration** — if you're already using LangChain, LangGraph is the natural choice
- **Pre-built agent patterns** — ReAct, plan-and-execute, multi-agent architectures
- **Cloud deployment** — LangGraph Cloud for hosted agent execution
- **Thread management** — built-in conversation thread persistence
- **Ecosystem** — integrations with LangSmith, LangServe, and the broader LangChain stack

## When to Choose callbag-recharge

- You want reactive state, not state dictionaries
- You need diamond resolution for consistent multi-source agent state
- You want free, built-in observability (not a paid SaaS)
- You're not in the LangChain ecosystem
- You need browser-side execution (local LLMs, edge AI)
- You want composable streaming operators for token processing
- Bundle size and zero dependencies matter
