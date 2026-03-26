# pipeline()

Declarative workflow builder. Wire steps into a DAG with automatic status tracking.

Use `task()` for work steps and `step()` only for source steps (triggers, cron).
Status is automatically derived from `task()` steps — no manual wiring needed.

## Signature

```ts
function pipeline<S extends Record<string, StepDef>>(
	steps: S,
	opts?: { name?: string; tasks?: Record<string, TaskState<any>>; timeout?: number },
): PipelineResult<S>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `steps` | `S` | Record of step name → StepDef. Use `task()` for work, `step()` for sources. |
| `opts` | `{ name?: string; tasks?: Record&lt;string, TaskState&lt;any&gt;&gt;; timeout?: number }` | Optional configuration: `name` (Inspector prefix), `tasks` (extra `TaskState` instances to fold into aggregate `status` when they are not attached to a `task()` step). |

## Returns

`PipelineResult&lt;S&gt;` — step stores, status, reset/destroy, and inner callbag details.

| Method | Signature | Description |
|--------|-----------|-------------|
| `steps` | `Record` | Access step stores by name. |
| `status` | `Store\&lt;PipelineStatus\&gt;` | Pipeline status: idle → active → completed/errored/paused. |
| `paused` | `Store\&lt;boolean\&gt;` | Reactive pause state — true when pipeline is paused. |
| `pause()` | `() =&gt; void` | Pause the pipeline via PAUSE TYPE 3 STATE signal (§1.15). In-flight tasks continue; new work is gated. |
| `resume()` | `() =&gt; void` | Resume after pause. Re-arms timeout if underlying status is active. |
| `reset(opts?)` | `(opts?: \{ resetExternalTasks?: boolean \}) =&gt; void` | Reset all steps and tasks to idle. Also clears paused state. |
| `destroy()` | `() =&gt; void` | Dispose subscriptions and destroy auto-detected task states. |
| `inner` | `PipelineInner` | Expert-level stream internals (streamStatus, stepMeta, order). |

## Basic Usage

```ts
import { pipeline, step, task, fromTrigger } from 'callbag-recharge/orchestrate';

const wf = pipeline({
    trigger: step(fromTrigger<string>()),
    fetch:   task(["trigger"], async (signal, [v]) => fetchData(v), { retry: 3 }),
    process: task(["fetch"], async (signal, [data]) => transform(data)),
  });

wf.steps.trigger.fire("go");
wf.status.get(); // "idle" → "active" → "completed"
```

## Options / Behavior Details

- **Auto-wiring:** Step deps are resolved by name. Factory functions receive dep stores in declared order.
- **Topological sort:** Steps are wired in dependency order. Cycles are detected and throw.
- **Auto status:** When using `task()` steps, `status` automatically tracks work execution (idle → active → completed/errored). Falls back to stream lifecycle tracking when no tasks are detected.
- **Skip propagation:** When a task's upstream deps all reach terminal states (success/error/skipped) with at least one non-success, the pipeline automatically marks the idle downstream task as "skipped". This cascades transitively through the DAG.
- **opts.tasks:** Pass additional `TaskState` stores so `status` reflects work outside `task()`-wrapped steps (e.g. UI demos that run `taskState` manually). Duplicates are deduped with auto-detected task states. Note: `destroy()` does NOT destroy externally provided `opts.tasks` — the caller owns their lifecycle.
- **Destroy ownership:** `destroy()` tears down subscriptions, destroys auto-detected `task()` states, and invalidates approval controls. Externally provided `opts.tasks` are left alive since the caller owns them.
- **Branch support:** Use `branch()` steps with compound deps like `"validate.fail"` for conditional routing.
- **Pause/resume:** `pause()` sends PAUSE TYPE 3 STATE signal through the graph (§1.15). Steps with `pausable()` operators gate DATA. In-flight async tasks continue — pause prevents new work, not cancellation. Use `reset()` to abort. `resume()` sends RESUME, re-arms timeout if active. Do not combine with imperative `pausable().pause()` on individual steps.
- **Per-step metrics:** `inner.stepMeta` includes reactive `StepMeta` with `errorCount`, `errorRate`, `startedAt`, `lastEmitAt`, `lastLatency`, `avgLatency`, `throughput`. Metrics reset on `reset()` and `destroy()`.

## See Also

- [task](./task) — value-level step
- [branch](./branch) — conditional routing
- [step](./pipeline) — expert-level step
