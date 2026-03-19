---
outline: deep
---

# How to Build a Reactive Data Pipeline in TypeScript

Transform, filter, batch, and aggregate streaming data using composable operators — with backpressure and type safety.

## The Problem

ETL pipelines typically use batch frameworks (Airflow, Spark) or imperative loops. Both lack:
- **Composability** — steps are wired with glue code, not a type-safe API
- **Backpressure** — producers overwhelm consumers without flow control
- **Reactivity** — no way to observe intermediate state or derived metrics

## The Solution

callbag-recharge treats every pipeline step as a composable store. `pipe()` chains operators that filter, transform, and batch — each step is inspectable and type-safe.

<<< @/../examples/data-pipeline.ts

## Why This Works

1. **`pipe()` composition** — each operator is a pure function. The chain is type-checked end-to-end.
2. **`filter()` + `map()`** — declarative transforms that read like the spec: "keep purchases, convert to cents."
3. **`bufferCount(n)`** — batches emissions into groups of n for efficient bulk writes. No manual array management.
4. **`scan()`** — running aggregation alongside the main pipeline. Both operate on the same source.
5. **Inspectable** — `Inspector.dumpGraph()` shows every step, its current value, and edges.

## Async Sources

Replace `fromIter` with `fromAsyncIter` for real async sources:

```ts
import { fromAsyncIter } from 'callbag-recharge/extra'

// Database cursor
const rows = fromAsyncIter(db.query('SELECT * FROM events'))

// SSE stream
const events = fromAsyncIter(sseStream)

// File lines
const lines = fromAsyncIter(readline.createInterface({ input: fs.createReadStream('data.csv') }))
```

## Adding Error Handling

Wrap the pipeline with `retry` and `rescue` for resilient processing:

```ts
import { retry, rescue } from 'callbag-recharge/extra'

const resilientPipeline = pipe(
  source,
  filter(row => row.type === 'purchase'),
  map(row => transform(row)),
  retry(3),                            // retry on transient errors
  rescue(() => fromIter([])),          // fallback to empty on permanent failure
  bufferCount(100),
)
```

## See Also

- [Cron Pipeline](./cron-pipeline) — schedule this pipeline on a cron trigger
- [AI Chat with Streaming](./ai-chat-streaming) — streaming with auto-cancellation
