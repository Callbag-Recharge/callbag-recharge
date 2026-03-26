# jobQueue()

Create a job queue backed by a topic and shared subscription.

Each call to `add(data)` publishes a message to the underlying topic.
The queue pulls messages, runs them through the processor function with
concurrency control, and tracks per-job status. Event listeners fire
on completion, failure, and stall detection.

## Signature

```ts
function jobQueue<T, R = void>(
	name: string,
	processor: (signal: AbortSignal, data: T, progress: (value: number) => void) => R | Promise<R>,
	opts?: JobQueueOptions<T>,
): JobQueue<T, R>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Queue name (used for topic and subscription naming). |
| `processor` | `(signal: AbortSignal, data: T, progress: (value: number) =&gt; void) =&gt; R | Promise&lt;R&gt;` | Function called per job. Receives `(signal, data, progress)`. Signal is aborted on stall (if configured) or destroy. Progress is a callback accepting 0-1 values. |
| `opts` | `JobQueueOptions&lt;T&gt;` | Queue configuration. |

## Returns

`JobQueue&lt;T, R&gt;` — queue with add, event subscription, companion stores, and lifecycle.
