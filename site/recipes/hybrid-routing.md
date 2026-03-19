---
outline: deep
---

# How to Build Hybrid Cloud+Edge Model Routing

Route LLM requests between local/edge models and cloud APIs based on complexity, with automatic fallback. Research shows 60% cost reduction and 40% latency improvement.

## The Problem

Running everything on cloud LLMs is expensive and slow. Running everything locally has quality limitations. The optimal strategy is hybrid routing:

- **Simple queries** (greetings, lookups, summarization) → local model (Ollama, WebLLM)
- **Complex queries** (multi-step reasoning, code generation) → cloud model (GPT-4, Claude)
- **Fallback** — if the local model fails or produces low-confidence output, fall back to cloud

No reactive library provides this pattern. Developers hand-wire `if/else` chains with no observability.

## The Solution

callbag-recharge's `route()` splits the request stream by predicate. `rescue()` catches local model failures and falls back to cloud. Everything is observable via `Inspector`.

<<< @/../examples/hybrid-routing.ts

## Why This Works

1. **`route(source, predicate)`** — splits the stream into `[matching, notMatching]`. Simple/moderate queries go to local; complex go to cloud. No if/else chains.

2. **`rescue()`** — wraps the local model pipeline. If inference fails (OOM, model not loaded, timeout), it automatically switches to the cloud fallback. Zero manual error handling.

3. **Observable routing stats** — `routingStats` is a reactive store. Dashboard, logs, or alerting can subscribe to it.

## Confidence-Based Routing

For more sophisticated routing, score the local model's output confidence:

```ts
const localWithConfidence = pipe(
  localRoute,
  switchMap(req => producer(({ emit, complete }) => {
    localInfer(req).then(result => {
      emit({ ...result, confidence: estimateConfidence(result) })
      complete()
    })
  }))
)

// Re-route low-confidence responses to cloud
const [confident, uncertain] = route(
  localWithConfidence,
  resp => resp.confidence > 0.8
)

// uncertain responses get re-processed by cloud
const cloudRefined = pipe(
  uncertain,
  switchMap(resp => cloudInfer({ prompt: resp.originalPrompt }))
)

// Merge confident local + cloud-refined responses
const finalResponses = merge(confident, cloudRefined, cloudResponse)
```

## Cost Tracking

Track routing economics reactively:

```ts
const costPerModel = { 'llama3.2': 0, 'gpt-4o': 0.003, 'claude-3.5': 0.004 }

const totalCost = derived([routingStats], () => {
  const stats = routingStats.get()
  return stats.totalCost
})

const costSavings = derived([routingStats], () => {
  const stats = routingStats.get()
  const cloudOnlyCost = (stats.localCount + stats.cloudCount) * costPerModel['gpt-4o']
  return cloudOnlyCost - stats.totalCost
})

effect([costSavings], () => {
  console.log(`Saved $${costSavings.get().toFixed(4)} via hybrid routing`)
})
```

## See Also

- [On-Device LLM Streaming](./on-device-llm-streaming) — manage local model token streams
- [Tool Calls for Local LLMs](./tool-calls) — reactive tool call lifecycle
