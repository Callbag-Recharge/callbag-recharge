# Job Queue

Standalone durable job processing built on topics and shared subscriptions. Concurrency control, progress tracking, priority ordering, scheduled execution, rate limiting, batch operations, introspection, persistence, and distributed processing — no external dependencies.

```ts
import { jobQueue, topic } from 'callbag-recharge/messaging';
```

---

## Creating a Queue

```ts
const q = jobQueue<InputType, ResultType>(
  'queue-name',
  async (signal, data, progress) => {
    progress(0.5);                          // report progress (0–1)
    if (signal.aborted) throw new Error('cancelled');
    return result;                          // returned in "completed" event
  },
  { concurrency: 5 },
);
```

The processor receives `(signal, data, progress)` — signal-first, matching the orchestrate convention. `signal` is aborted on destroy, removal, or stall cancellation.

---

## Adding Jobs

```ts
// Single job — returns sequence number
const seq = q.add({ email: 'alice@example.com' });

// With priority (lower = first within a pull batch)
q.add(data, { priority: 1 });

// Scheduled execution
q.add(data, { runAt: new Date(Date.now() + 30_000) });

// Batch add — atomic, returns all sequence numbers
const seqs = q.addBatch([item1, item2, item3]);
```

Priority sorting is batch-scoped: jobs are sorted by priority within each pull batch from the underlying subscription.

---

## Companion Stores

Reactive stores update automatically as jobs flow through the queue:

```ts
import { subscribe } from 'callbag-recharge/extra';

subscribe(q.active, (n) => console.log(`Active: ${n}`));
subscribe(q.completed, (n) => console.log(`Completed: ${n}`));
subscribe(q.failed, (n) => console.log(`Failed: ${n}`));
subscribe(q.waiting, (n) => console.log(`Waiting: ${n}`));
subscribe(q.progress, (p) => console.log(`Progress: ${(p * 100).toFixed(0)}%`));
```

`progress` is an aggregate (0–1) across all active jobs.

---

## Events

```ts
q.on('completed', (job) => {
  console.log(job.seq, job.result, job.duration);
});
q.on('failed', (job) => {
  console.log(job.seq, job.error, job.attempts);
});
q.on('stalled', (job) => {
  // ackTimeout exceeded — job still running
});
q.on('progress', (job) => {
  console.log(job.seq, job.progress); // 0–1
});
```

---

## Introspection

```ts
const info = q.getJob(seq);
// → { seq, data, status, attempts, result?, error?, progress, addedAt, startedAt?, completedAt? }

q.remove(seq); // cancel and remove — in-flight jobs are aborted via signal
```

`status` is one of: `"waiting"` | `"active"` | `"completed"` | `"failed"` | `"stalled"` | `"scheduled"`.

Finished jobs are retained for introspection (up to 10,000 FIFO).

---

## Retry and Dead Letter Queue

```ts
const dlq = topic<string>('failed-jobs');

const q = jobQueue<string, void>('work', processor, {
  retry: { maxRetries: 3, backoff: () => 100 },  // 3 retries after initial attempt
  deadLetterTopic: dlq,                           // terminal failures route here
});
```

`maxRetries: 3` means up to 4 total attempts (1 initial + 3 retries). After exhaustion, the job is published to the dead letter topic if configured.

---

## Rate Limiting

```ts
const q = jobQueue<string, Response>('api-calls', processor, {
  concurrency: 10,
  rateLimit: { max: 5, windowMs: 1000 },  // max 5 job starts per second
});
```

Uses the sliding window rate limiter from `callbag-recharge/utils`. Jobs that can't start immediately are queued and dispatched as the window slides.

---

## Scheduled Jobs

```ts
q.add('report', { runAt: new Date(Date.now() + 60_000) });

const info = q.getJob(seq);
console.log(info?.status); // "scheduled" until runAt
```

Scheduled jobs wait in a timer-based queue and enter processing when their time arrives, subject to concurrency limits.

---

## Lifecycle

```ts
q.pause();       // stop pulling new jobs (in-flight continue)
q.resume();      // resume pulling + drain deferred queue
q.isPaused;      // boolean

q.destroy();     // abort all in-flight, tear down resources
```

---

## Persistence

```ts
import { memoryAdapter } from 'callbag-recharge/utils';

const adapter = memoryAdapter();

const q = jobQueue<string, string>('persistent', processor, {
  persistence: adapter,
});
```

On restart, create a new queue with the same name and adapter. Completed/failed jobs are recovered for introspection via `getJob()`.

The `CheckpointAdapter` must emit values synchronously. Async adapters are not supported (a warning is logged).

---

## Distributed Processing

Expose the internal topic for bridging to remote workers:

```ts
import { topicBridge, wsMessageTransport } from 'callbag-recharge/messaging';

const bridge = topicBridge(
  wsMessageTransport({ url: 'ws://worker:8080' }),
  { 'emails:jobs': { topic: q.inner.topic } },
);
```

Remote workers consume from the same topic, enabling distributed job processing across nodes.

---

## Full Options Reference

```ts
interface JobQueueOptions<T> {
  concurrency?: number;                              // default 1
  ackTimeout?: number;                               // stall detection (ms)
  stalledJobAction?: 'none' | 'retry' | 'cancel';   // default 'none'
  retry?: {
    maxRetries: number;
    backoff: (attempt: number) => number;            // ms delay per attempt
  };
  deadLetterTopic?: Topic<T>;
  rateLimit?: { max: number; windowMs: number };
  persistence?: CheckpointAdapter;
}
```
