---
outline: deep
---

# Job Queue

Build a standalone durable job processing system with `jobQueue()` — concurrency, progress tracking, priority ordering, scheduled execution, rate limiting, batch operations, introspection, persistence, and distributed processing.

## The Problem

Background job processing typically requires external infrastructure (Redis + BullMQ, SQS, Celery). This recipe shows how to build a fully-featured job queue in-process using callbag-recharge's messaging primitives — no external dependencies.

## The Solution

<<< @/../examples/job-queue.ts

## API Overview

### Creating a queue

```ts
const q = jobQueue<InputType, ResultType>(
  "queue-name",
  async (signal, data, progress) => {
    progress(0.5);        // report progress (0–1)
    if (signal.aborted) throw new Error("cancelled");
    return result;        // returned to "completed" event
  },
  {
    concurrency: 5,                          // parallel workers
    rateLimit: { max: 10, windowMs: 1000 },  // throttle starts
    retry: { maxRetries: 3, backoff: exponential() },
    persistence: memoryAdapter(),             // survive restarts
    deadLetterTopic: dlq,                    // terminal failures
  },
);
```

### Adding jobs

| Method | Description |
|--------|-------------|
| `q.add(data)` | Add a single job. Returns sequence number. |
| `q.add(data, { priority: 1 })` | Priority ordering (lower = first). |
| `q.add(data, { runAt: new Date(...) })` | Scheduled execution. |
| `q.addBatch(items)` | Atomic batch add. Returns sequence numbers. |

### Reactive companion stores

| Store | Type | Description |
|-------|------|-------------|
| `q.active` | `Store<number>` | Currently processing jobs |
| `q.completed` | `Store<number>` | Total completed |
| `q.failed` | `Store<number>` | Total failed |
| `q.waiting` | `Store<number>` | Backlog size |
| `q.progress` | `Store<number>` | Aggregate progress (0–1) across active jobs |

### Events

```ts
q.on("completed", (job) => { /* job.result, job.duration */ });
q.on("failed",    (job) => { /* job.error, job.attempts  */ });
q.on("stalled",   (job) => { /* ackTimeout exceeded      */ });
q.on("progress",  (job) => { /* job.progress (0–1)       */ });
```

### Introspection

```ts
q.getJob(seq);   // → JobInfo | undefined (status, attempts, result, error, progress)
q.remove(seq);   // → boolean — cancel and remove a job
```

### Lifecycle

```ts
q.pause();       // stop pulling new jobs (in-flight continue)
q.resume();      // resume pulling
q.isPaused;      // boolean
q.destroy();     // tear down all resources
```

### Distributed processing

Expose the internal topic for bridging to remote workers:

```ts
import { topicBridge, wsMessageTransport } from 'callbag-recharge/messaging';

const bridge = topicBridge(
  wsMessageTransport({ url: 'ws://worker:8080' }),
  { 'emails:jobs': { topic: q.inner.topic } },
);
```

## Primitives Used

| Primitive | From | Role |
|---|---|---|
| `jobQueue()` | `callbag-recharge/messaging` | Core job processing engine |
| `topic()` | `callbag-recharge/messaging` | Dead letter queue for failed jobs |
| `topicBridge()` | `callbag-recharge/messaging` | Distributed job processing |
| `subscribe()` | `callbag-recharge/extra` | React to companion stores |
| `memoryAdapter()` | `callbag-recharge/utils` | In-memory persistence |
| `exponential()` | `callbag-recharge/utils` | Retry backoff strategy |

## Design Notes

- **Signal-first:** Processor receives `(signal, data, progress)` — signal is always first, matching the orchestrate convention.
- **No polling:** Job dispatch is push-based via reactive subscription on topic depth changes.
- **No raw Promises:** Retry delays use `fromTimer()`, rate limiting uses `slidingWindow.acquire()` — all callbag-native.
- **Priority is batch-scoped:** Jobs are sorted by priority within each pull batch. For full backlog ordering, a future `priorityOrder` flag on subscription `pull()` is planned.
- **Persistence is sync-only:** The `CheckpointAdapter` must emit values synchronously (e.g., `memoryAdapter()`). Async adapters are not supported.
