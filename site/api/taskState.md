# taskState()

Creates a reactive task execution tracker with automatic status, duration, and error tracking.

## Signature

```ts
function taskState<T = unknown>(opts?: { id?: string }): TaskState<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `{ id?: string }` | Optional configuration. |

## Returns

`TaskState&lt;T&gt;` — a task tracker with the following API:

| Method | Signature | Description |
|--------|-----------|-------------|
| `run(fn)` | `(fn: (signal: AbortSignal) =&gt; T \` | Promise&lt;T&gt;) =&gt; Promise&lt;T&gt; |
| `get()` | `() =&gt; TaskMeta&lt;T&gt;` | Returns the current metadata snapshot (status, result, error, duration, runCount). |
| `status` | `Store&lt;TaskStatus&gt;` | Reactive store: 'idle' \ |
| `result` | `Store&lt;T \` | undefined&gt; |
| `error` | `Store&lt;unknown \` | undefined&gt; |
| `duration` | `Store&lt;number \` | undefined&gt; |
| `runCount` | `Store&lt;number&gt;` | Reactive store of total run count. |
| `reset()` | `() =&gt; void` | Reset to idle state and abort any running task. |
| `destroy()` | `() =&gt; void` | Tear down all reactive stores. |

## Basic Usage

```ts
import { taskState } from 'callbag-recharge';

const task = taskState<string>();
await task.run((signal) => fetch('/api', { signal }).then(r => r.text()));
task.status.get(); // 'success'
task.duration.get(); // e.g. 120
```

## Options / Behavior Details

- **Signal-first:** The `run()` callback receives an `AbortSignal` as its first argument for cooperative cancellation.
- **Companion stores:** Each metadata field is an individual reactive store, independently subscribable.
- **Generation tracking:** Concurrent `reset()` during a `run()` silently discards the stale result.

## See Also

- [track](./track) — lifecycle tracking
- [pipeline](./pipeline) — workflow builder
