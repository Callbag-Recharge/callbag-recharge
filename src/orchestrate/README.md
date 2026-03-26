# Orchestrate

Declarative workflow engine for TypeScript. Build DAG-based pipelines with automatic status tracking, pause/resume, metrics, conditional routing, human-in-the-loop approvals, and durable execution — all reactive, all composable.

Think "Airflow/n8n in TypeScript" — but the DAG executor is the reactive graph itself. `derived()` + `effect()` with explicit deps IS the scheduler. No separate engine needed.

```ts
import { pipeline, source, task, fromTrigger } from 'callbag-recharge/orchestrate';
```

---

## Quick Start

```ts
const trigger = fromTrigger<string>();

const wf = pipeline({
  trigger: source(trigger),
  fetch:   task(["trigger"], async (signal, [url]) => {
    const res = await fetch(url, { signal });
    return res.json();
  }, { retry: 3, timeout: 5000 }),
  process: task(["fetch"], async (signal, [data]) => transform(data)),
});

// Fire the pipeline
trigger.fire("https://api.example.com/data");

// Reactive status: idle → active → completed/errored
subscribe(wf.status, (s) => console.log("Pipeline:", s));

// Pause/resume (TYPE 3 STATE signals through the graph)
wf.pause();   // status → "paused", new work gated
wf.resume();  // status → restores, timeout re-arms

// Reset for re-trigger
wf.reset();
trigger.fire("https://api.example.com/other");

// Cleanup
wf.destroy();
```

---

## What You Can Build

| Pattern | Modules | Example |
|---------|---------|---------|
| **ETL pipeline** | `pipeline`, `task`, `source` | Trigger → fetch → transform → load |
| **Approval workflow** | `approval`, `gate` | Submit → human review → approve/reject → notify |
| **Conditional routing** | `branch`, `switchStep` | Validate → pass/fail branches, or N-way routing |
| **Fan-out/fan-in** | `forEach`, `join` | Split array → parallel tasks → merge results |
| **Retry with backoff** | `task` + `retry` option | Auto-retry with exponential/fibonacci/constant backoff |
| **Sensor polling** | `sensor` | Wait for external condition (file exists, API ready) |
| **Scheduled jobs** | `fromTrigger` + `fromCron` | Cron-triggered pipelines |
| **Nested workflows** | `subPipeline` | Parent pipeline invokes child pipeline |
| **Long-running supervisor** | `pipelineRunner` | Health checks, auto-restart, circuit breaker |
| **Error routing** | `onFailure` | Dead letter queue for failed tasks |
| **Pipeline visualization** | `toMermaid`, `toD2`, `dagLayout` | Export DAG as diagram or layout coordinates |

---

## Pipeline Nodes

### `source(store)` — Event entry point

Wraps a reactive store (trigger, cron, WebSocket, etc.) as a pipeline entry point. Sources are long-lived emitters that never block pipeline completion.

```ts
const trigger = fromTrigger<string>();
const wf = pipeline({
  input: source(trigger),
  // ... downstream steps
});
trigger.fire("hello");
```

### `task(deps, fn, opts?)` — Async work step

The primary building block. Receives **values** (not stores) — the framework handles diamond resolution, re-trigger cancellation, and lifecycle tracking.

```ts
task(["input"], async (signal, [value]) => {
  const res = await fetch(`/api/${value}`, { signal });
  return res.json();
}, {
  retry: { count: 3, backoff: "exponential" },
  timeout: 5000,
  skip: ([v]) => v === "skip-me",
  fallback: (err) => ({ error: String(err) }),
  onStart: ([v]) => console.log("started with", v),
  onSuccess: (result) => console.log("done:", result),
  onError: (err) => console.error("failed:", err),
})
```

**Key behaviors:**
- Auto-join: waits for ALL deps to emit non-undefined values
- Re-trigger: new upstream values cancel the previous in-flight execution (switchMap semantics)
- Skip propagation: if upstream deps fail/skip, idle downstream tasks are auto-marked "skipped"

### `branch(dep, predicate)` — Binary conditional routing

Splits values into pass/fail branches. Downstream steps reference `"step.fail"` for the fail branch.

```ts
const wf = pipeline({
  input:    source(trigger),
  validate: branch("input", (v) => v.isValid),
  onPass:   task(["validate"], async (signal, [v]) => process(v)),
  onFail:   task(["validate.fail"], async (signal, [v]) => reject(v)),
});
```

### `switchStep(dep, dispatcher, cases)` — N-way routing

Routes values to named cases based on a dispatcher function.

```ts
const wf = pipeline({
  input: source(trigger),
  route: switchStep("input", (v) => v.priority, ["high", "medium", "low"]),
  handleHigh:   task(["route.high"], async (signal, [v]) => escalate(v)),
  handleMedium: task(["route.medium"], async (signal, [v]) => process(v)),
  handleLow:    task(["route.low"], async (signal, [v]) => archive(v)),
});
```

### `approval(dep, opts?)` — Human-in-the-loop

Values queue until a human approves, rejects, or modifies them.

```ts
const reviewDef = approval<string>("input");
const wf = pipeline({
  input:  source(trigger),
  review: reviewDef,
  after:  task(["review"], async (signal, [v]) => finalize(v)),
});

// UI binds to:
reviewDef.pending.get();  // ["item1", "item2"]
reviewDef.approve(1);     // release first item
reviewDef.reject(1);      // drop next item
reviewDef.modify((v) => v.toUpperCase()); // transform and release
```

### `forEach(dep, fn, opts?)` — Fan-out parallel tasks

Splits an array dependency into parallel task instances.

```ts
const wf = pipeline({
  input:  source(trigger),  // fires ["a", "b", "c"]
  fanout: forEach("input", async (signal, item) => process(item), {
    concurrency: 3,
  }),
});
```

### `join(deps, opts?)` — Merge multiple branches

Merges values from multiple deps with built-in strategies: `append`, `merge` (by key), `intersect`.

```ts
const wf = pipeline({
  a: task([], async () => [{ id: 1, name: "Alice" }]),
  b: task([], async () => [{ id: 2, name: "Bob" }]),
  merged: join(["a", "b"], { strategy: "append" }),
});
```

### `sensor(dep, predicate, opts?)` — Wait for external condition

Polls until a condition is true (Airflow sensor pattern).

```ts
const wf = pipeline({
  trigger: source(fromTrigger()),
  ready:   sensor("trigger", async (signal) => {
    const res = await fetch("/health", { signal });
    return res.ok;
  }, { interval: 5000, timeout: 60000 }),
  work:    task(["ready"], async (signal) => doWork()),
});
```

### `wait(dep, opts)` — Intentional delay

Pauses for a duration or until a signal fires.

```ts
const wf = pipeline({
  input: source(trigger),
  delay: wait("input", { duration: 3000 }),
  after: task(["delay"], async (signal, [v]) => process(v)),
});
```

### `loop(def, opts?)` — Repeat until condition

Repeats a sub-graph until a condition is met.

```ts
const wf = pipeline({
  trigger: source(fromTrigger()),
  retry:   loop({
    deps: ["trigger"],
    body: (signal, [input]) => pipeline({
      attempt: task([], async () => tryOperation(input)),
    }),
    until: (result) => result.success,
  }, { maxIterations: 5 }),
});
```

### `onFailure(dep, fn)` — Error handler / dead letter

Routes terminal task failures to a handler. Excluded from skip propagation.

```ts
const wf = pipeline({
  input:  source(trigger),
  work:   task(["input"], async () => riskyOperation()),
  handle: onFailure("work", async (signal, error) => {
    await notifySlack(error);
  }),
});
```

### `subPipeline(dep, factory)` — Nested workflow

Invokes a child pipeline from a parent with lifecycle management.

```ts
const wf = pipeline({
  trigger: source(fromTrigger()),
  child:   subPipeline("trigger", (signal, [input]) => pipeline({
    step1: task([], async () => processInChild(input)),
    step2: task(["step1"], async (signal, [v]) => finalize(v)),
  })),
});
```

---

## Pipeline Lifecycle

### Status

```
idle → active → completed
                 errored
                 paused (via pause())
```

`PipelineStatus = "idle" | "active" | "completed" | "errored" | "paused"`

Status is derived from `task()` steps automatically. Falls back to stream lifecycle when no tasks exist.

### Pause / Resume

```ts
wf.pause();                 // status → "paused", PAUSE signal through graph
wf.paused.get();            // true
wf.resume();                // status restores, RESUME signal through graph

// In-flight tasks continue to completion — pause prevents NEW work
// Use wf.reset() to abort in-flight work
```

### Reset

```ts
wf.reset();                 // all tasks → idle, metrics cleared, timeout reset
wf.reset({ resetExternalTasks: false }); // skip externally-provided tasks
```

### Timeout

```ts
const wf = pipeline({ ... }, { timeout: 30000 }); // 30s pipeline timeout
// Arms on idle→active, disarms on completion/error/pause
// Reports "errored" if exceeded
```

---

## Per-Step Metrics

Every step tracks reactive metrics via `inner.stepMeta`:

```ts
const meta = wf.inner.stepMeta.fetch.get();
// {
//   status: "active",
//   count: 5,           // values emitted
//   errorCount: 1,      // errors encountered
//   errorRate: 0.166,   // errorCount / (count + errorCount)
//   startedAt: 17...,   // epoch ms of subscription
//   lastEmitAt: 17...,  // epoch ms of last emission
//   lastLatency: 42,    // ms since previous emission
//   avgLatency: 38.5,   // running average latency
//   throughput: 12.5,   // values per second since startedAt
// }
```

### Snapshot

```ts
const snap = wf.inspect();
// {
//   status: "completed",
//   order: ["trigger", "fetch", "process"],
//   steps: {
//     trigger: { status: "active", count: 1, throughput: ... },
//     fetch:   { status: "completed", count: 1, task: { status: "success", duration: 120 } },
//     process: { status: "completed", count: 1, ... },
//   }
// }
```

---

## Visualization

```ts
import { toMermaid, toD2, dagLayout } from 'callbag-recharge/orchestrate';

// Mermaid diagram
const mermaid = toMermaid(wf);
// graph TD
//   trigger --> fetch
//   fetch --> process

// D2 diagram
const d2 = toD2(wf);

// Layout coordinates for custom rendering
const layout = dagLayout(wf);
// { nodes: [{ id: "trigger", x: 0, y: 0, ... }], edges: [...] }
```

---

## Durable Execution

```ts
import { executionLog, memoryLogAdapter } from 'callbag-recharge/orchestrate';

const log = executionLog(wf, {
  adapter: memoryLogAdapter(),
});

// Auto-records: step starts, values, completions, errors
log.entries.get(); // [{ type: "start", step: "fetch", ... }, ...]
```

Persistence adapters: `memoryLogAdapter` (in-memory), `indexedDBLogAdapter` (browser), `sqliteLogAdapter` (Node), `fileLogAdapter` (Node, from `orchestrate/node`).

---

## Pipeline Runner (Supervisor)

For long-running pipelines that need health checks and auto-restart:

```ts
import { pipelineRunner } from 'callbag-recharge/orchestrate';

const runner = pipelineRunner({
  factory: () => pipeline({ ... }),
  autoRestart: true,
  maxRestarts: 5,
  healthCheck: { interval: 10000 },
});

runner.status.get(); // "running" | "stopped" | "restarting"
runner.stop();
```

---

## Module Reference

| Module | Role | Category |
|--------|------|----------|
| `pipeline` | DAG builder with auto-wiring and status | Builder |
| `source` | Event entry point (trigger, cron, etc.) | Node |
| `task` | Async work step with lifecycle | Node |
| `branch` | Binary conditional routing | Node |
| `switchStep` | N-way conditional routing | Node |
| `approval` | Human-in-the-loop queue | Node |
| `forEach` | Fan-out parallel tasks | Node |
| `join` | Merge multiple branches | Node |
| `sensor` | Poll until condition met | Node |
| `wait` | Intentional delay | Node |
| `loop` | Repeat until condition | Node |
| `onFailure` | Dead letter / error handler | Node |
| `subPipeline` | Nested workflow | Node |
| `gate` | Low-level approval operator | Plumbing |
| `taskState` | Reactive task tracker | Plumbing |
| `executionLog` | Durable execution history | Observability |
| `toMermaid` / `toD2` | Diagram export | Visualization |
| `dagLayout` | Layout coordinates | Visualization |
| `pipelineRunner` | Long-running supervisor | Operations |
| `workflowNode` | Bundled task + log + breaker | Composition |

All imports from `callbag-recharge/orchestrate`. Re-exports `state`, `effect`, `fromTrigger` for convenience.
