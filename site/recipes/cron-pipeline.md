---
outline: deep
---

# How to Build a Cron Pipeline in TypeScript (Airflow Alternative)

Schedule data pipelines with cron triggers, automatic retry, and diamond-safe aggregation — no infrastructure required.

## The Problem

Airflow, Prefect, and Temporal require:
- A separate server process or managed service
- Python (or a complex SDK)
- DAG definitions in a different language/format than your app code

For many pipelines, you just need: **trigger on schedule → fetch data → aggregate → report**. In the same TypeScript codebase.

## The Solution

callbag-recharge's `fromCron()` is a reactive source that emits on schedule. Compose it with `exhaustMap` (ignore overlapping triggers), `retry`, and `derived` (diamond-safe aggregation).

<<< @/../examples/cron-pipeline.ts

## Why This Works

1. **`fromCron('0 9 * * *')`** — emits on schedule with a zero-dependency cron parser. No external scheduler needed.

2. **`exhaustMap()`** — if the previous fetch is still running when the next cron tick fires, the new trigger is ignored. No duplicate runs.

3. **`retry(3)`** — automatically re-subscribes on error, up to 3 times. Transient failures self-heal.

4. **`derived([bankData, cardData], fn)`** — diamond-safe aggregation. When both sources complete from the same trigger, the aggregate computes exactly once.

## Adding Persistence

Make the pipeline survive restarts with `checkpoint()`:

```ts
import { checkpoint, sqliteAdapter } from 'callbag-recharge/utils'

const adapter = sqliteAdapter({ path: './pipeline.db' })

const bankData = pipe(
  trigger,
  exhaustMap(() => fromPromise(plaid.sync())),
  retry(3),
  checkpoint('bank-fetch', adapter), // persists last successful value
)
```

On restart, `checkpoint()` replays the last persisted value — downstream steps skip redundant computation.

## Adding Execution Logging

```ts
import { executionLog, memoryLogAdapter } from 'callbag-recharge/orchestrate'

const log = executionLog({ adapter: memoryLogAdapter() })
// Auto-logs every step event: started, completed, failed, retried
```

## Full Pipeline Builder

For complex DAGs with multiple steps and dependencies:

```ts
import { pipeline, step } from 'callbag-recharge/orchestrate'

const workflow = pipeline([
  step('fetch-bank', () => pipe(trigger, exhaustMap(() => fromPromise(plaid.sync())))),
  step('fetch-cards', () => pipe(trigger, exhaustMap(() => fromPromise(stripe.charges())))),
  step('aggregate', (bank, cards) => derived([bank, cards], () => merge(bank.get(), cards.get())), ['fetch-bank', 'fetch-cards']),
  step('report', (data) => effect([data], () => sendReport(data.get())), ['aggregate']),
])
```

## See Also

- [Data Pipeline](./data-pipeline) — ETL without scheduling
- [Real-Time Dashboard](./real-time-dashboard) — reactive metrics from pipeline output
