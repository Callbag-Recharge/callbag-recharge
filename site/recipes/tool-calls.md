---
outline: deep
---

# How to Coordinate Tool Calls for Local LLMs in the Browser

Build a reactive state machine for the LLM tool call lifecycle: request → execute → result → continue. Observable, type-safe, and framework-agnostic.

## The Problem

LLM tool calling follows a strict lifecycle:
1. LLM generates a tool call request
2. App validates and executes the tool
3. Result feeds back to the LLM
4. LLM continues generation with the result

This is currently hand-wired everywhere — scattered `useState`, `switch` statements, and manual state transitions. No observability, no type safety, error handling is an afterthought.

## The Solution

callbag-recharge's `stateMachine` util provides a typed FSM with observable state. `derived` creates reactive views. `effect` handles side effects. The entire lifecycle is inspectable.

<<< @/../examples/tool-calls.ts

## Why This Works

1. **`stateMachine()` with typed transitions** — every state and event is typed. Invalid transitions are compile-time errors. The state machine enforces the lifecycle.

2. **Observable state** — `toolFSM.store` is a reactive `Store`. Subscribe to status changes, derive metrics, or trigger effects.

3. **`derived()` views** — `isExecuting` and `lastResult` are derived stores that update reactively. No manual synchronization.

4. **`effect()` side effects** — feed tool results back to the LLM, update UI, or log events — all reactive.

## Multi-Tool Parallel Execution

When the LLM requests multiple tools at once:

```ts
import { reactiveMap } from 'callbag-recharge/data'

// Track multiple tool calls in parallel
const toolCalls = reactiveMap<string, ToolState>()

async function handleParallelCalls(calls: ToolCall[]) {
  // Start all tools
  for (const call of calls) {
    toolCalls.set(call.name, { status: 'executing', call, startedAt: Date.now() })
  }

  // Execute in parallel
  const results = await Promise.allSettled(
    calls.map(async call => {
      const result = await tools[call.name](call.args)
      toolCalls.update(call.name, s => ({
        ...s, status: 'completed', result
      }))
      return { name: call.name, result }
    })
  )

  // All tools resolved — reactive sizeStore tracks completion
  return results
}

// Derived: are all tools done?
const allCompleted = derived(
  [toolCalls.sizeStore],
  () => {
    let done = true
    toolCalls.forEach((state) => {
      if (state.status === 'executing') done = false
    })
    return done
  }
)
```

## Tool Call with Timeout

Wrap tool execution with `withTimeout`:

```ts
import { withTimeout } from 'callbag-recharge/orchestrate'

const timedTool = pipe(
  toolExecution,
  withTimeout(5000), // 5 second timeout
  rescue(() => producer(({ emit, complete }) => {
    emit({ name: 'timeout', result: 'Tool execution timed out', durationMs: 5000 })
    complete()
  }))
)
```

## Agentic Loop Pattern

Chain tool calls in an observe-plan-act loop:

```ts
const agentPhase = state<'observe' | 'plan' | 'act'>('observe')

const agentLoop = dynamicDerived((get) => {
  const phase = get(agentPhase)
  switch (phase) {
    case 'observe': return get(environmentState)
    case 'plan': return get(llmPlan)
    case 'act': return get(toolFSM.store)
  }
})

effect([agentLoop], () => {
  const phase = agentPhase.get()
  const result = agentLoop.get()

  if (phase === 'act' && result.status === 'completed') {
    agentPhase.set('observe') // cycle back
  }
})
```

## See Also

- [On-Device LLM Streaming](./on-device-llm-streaming) — manage local model token streams
- [Hybrid Cloud+Edge Routing](./hybrid-routing) — route between local and cloud models
- [AI Chat with Streaming](./ai-chat-streaming) — streaming chat pattern
