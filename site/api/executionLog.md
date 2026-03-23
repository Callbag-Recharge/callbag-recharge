# executionLog()

Creates a reactive execution log for workflow step tracking. Backed by `reactiveLog` (Phase 3b).

## Signature

```ts
function executionLog(opts?: ExecutionLogOptions): ExecutionLogResult
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `opts` | `ExecutionLogOptions` | Optional configuration. |

## Returns

`ExecutionLogResult` — reactive log with step filtering, pipeline auto-connect, and optional persistence.

| Method | Signature | Description |
|--------|-----------|-------------|
| `log` | `ReactiveLog\&lt;ExecutionEntry\&gt;` | Underlying reactive log. |
| `append(entry)` | `(entry) =&gt; number` | Append an execution event. |
| `forStep(step)` | `(step) =&gt; ExecutionEntry[]` | Get entries for a specific step. |
| `latest` | `Store\&lt;ExecutionEntry \` | undefined\&gt; |
| `length` | `Store\&lt;number\&gt;` | Reactive entry count. |
| `persistError` | `Store\&lt;unknown\&gt;` | Last persist error (null when healthy). |
| `connectPipeline(stepMeta, names)` | `(...) =&gt; () =&gt; void` | Auto-log pipeline step events. |
| `clear()` | `() =&gt; void` | Clear the log. |
| `destroy()` | `() =&gt; void` | Destroy and clean up. |

## Basic Usage

```ts
import { executionLog } from 'callbag-recharge/orchestrate';
import { pipeline, step, fromTrigger } from 'callbag-recharge/orchestrate';

const log = executionLog({ maxSize: 500 });
const wf = pipeline({
    trigger: step(fromTrigger<number>()),
  });
const unsub = log.connectPipeline(wf.stepMeta, wf.order);
// Events auto-logged as pipeline runs
log.forStep("trigger"); // all events for "trigger" step
unsub();
```

## Options / Behavior Details

- **Auto-logging:** `connectPipeline()` subscribes to per-step metadata stores and auto-appends start/value/complete/error events.
- **Persistence:** Optional adapter writes through on every append. Load on construction for recovery.
- **Bounded:** Set `maxSize` for production to prevent unbounded memory growth.

## See Also

- [pipeline](./pipeline) — workflow builder
- [reactiveLog](./reactiveLog) — underlying data structure
