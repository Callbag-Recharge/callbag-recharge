---
outline: deep
---

# How to Manage On-Device LLM Streaming State

Stream tokens from a local LLM (Ollama, WebLLM, ExecuTorch) into reactive state with auto-cancellation, chunk accumulation, and derived metrics.

## The Problem

On-device / edge LLM inference is production-ready (WebGPU in all browsers, Ollama as local standard, ExecuTorch on mobile). But managing the streaming state is manual:

- Token-by-token accumulation into a response string
- Cancelling in-flight inference when the user sends a new prompt
- Tracking metrics (token count, latency, streaming status)
- Handling errors from model loading failures or OOM

Every framework reimplements this with `useState` + `useEffect` + `AbortController` + refs.

## The Solution

callbag-recharge treats the LLM token stream as a reactive `producer`. `switchMap` auto-cancels previous inference. `scan` accumulates tokens. `derived` computes metrics. All observable via `Inspector`.

<<< @/../examples/on-device-llm.ts

## Why This Works

1. **`producer()` wraps any streaming API** — Ollama's HTTP streaming, WebLLM's `ChatModule.generate()`, or any OpenAI-compatible endpoint. The cleanup function aborts in-flight inference.

2. **`switchMap` auto-cancels** — when the user sends a new prompt, the previous inference is cancelled via `AbortController`. No manual cleanup, no race conditions.

3. **`scan` accumulates tokens** — each token emission grows the response string. The accumulated value is always current.

4. **`derived` computes metrics** — token count, character count, and any other derived state update reactively as the response grows.

## WebLLM Integration

For browser-based inference via WebLLM:

```ts
import { producer } from 'callbag-recharge'

const webllmTokens = producer<string>(({ emit, complete, error }) => {
  let engine: any
  ;(async () => {
    engine = await webllm.CreateMLCEngine('Llama-3.2-1B-Instruct-q4f16_1-MLC')
    const stream = await engine.chat.completions.create({
      messages: [{ role: 'user', content: prompt.get() }],
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

## Context Window as Derived Computation

Track token budget reactively:

```ts
const contextLimit = 4096
const systemPromptTokens = 200

const history = state<Message[]>([])
const historyTokens = derived([history], () =>
  history.get().reduce((sum, msg) => sum + estimateTokens(msg.content), 0)
)
const availableTokens = derived(
  [historyTokens],
  () => contextLimit - systemPromptTokens - historyTokens.get()
)
const shouldTruncate = derived(
  [availableTokens],
  () => availableTokens.get() < 100
)
```

## Error Handling

Wrap with `retry` and `rescue` for resilient inference:

```ts
import { retry, rescue } from 'callbag-recharge/extra'

const resilientTokens = pipe(
  tokens,
  retry(2),                              // retry model loading failures
  rescue(() => cloudFallbackTokens),     // fall back to cloud API
)
```

## See Also

- [Hybrid Cloud+Edge Routing](./hybrid-routing) — route between local and cloud models
- [Tool Calls for Local LLMs](./tool-calls) — reactive tool call lifecycle
- [AI Chat with Streaming](./ai-chat-streaming) — cloud LLM streaming pattern
