# pipeline()

Declarative workflow builder. Wire steps into a DAG with automatic status tracking.

Use `task()` for work steps and `step()` only for source steps (triggers, cron).
Status is automatically derived from `task()` steps — no manual wiring needed.

## Signature

```ts
function pipeline<S extends Record<string, StepDef>>(
	steps: S,
	opts?: { name?: string; tasks?: Record<string, TaskState<any>> },
): PipelineResult<S>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `steps` | `S` | Record of step name → StepDef. Use `task()` for work, `step()` for sources. |
| `opts` | `{ name?: string; tasks?: Record&lt;string, TaskState&lt;any&gt;&gt; }` | Optional configuration: `name` (Inspector prefix), `tasks` (extra `TaskState` instances to fold into aggregate `status` when they are not attached to a `task()` step). |

## Returns

`PipelineResult&lt;S&gt;` — step stores, status, reset/destroy, and inner callbag details.

| Method | Signature | Description |
|--------|-----------|-------------|
| `steps` | `Record` | Access step stores by name. |
| `status` | `Store\&lt;PipelineStatus\&gt;` | Pipeline status: idle → active → completed/errored. |
| `reset()` | `() =&gt; void` | Reset all steps and tasks to idle for re-trigger. |
| `destroy()` | `() =&gt; void` | Dispose subscriptions and destroy auto-detected task states. |
| `inner` | `PipelineInner` | Expert-level stream internals (streamStatus, stepMeta, order). |

## Basic Usage

```ts
import { pipeline, step, task, fromTrigger } from 'callbag-recharge/orchestrate';

const wf = pipeline({
    trigger: step(fromTrigger<string>()),
    fetch:   task(["trigger"], async (v) => fetchData(v), { retry: 3 }),
    process: task(["fetch"], async (data) => transform(data)),
  });

wf.steps.trigger.fire("go");
wf.status.get(); // "idle" → "active" → "completed"
```

## Options / Behavior Details

- **Auto-wiring:** Step deps are resolved by name. Factory functions receive dep stores in declared order.
- **Topological sort:** Steps are wired in dependency order. Cycles are detected and throw.
- **Auto status:** When using `task()` steps, `status` automatically tracks work execution (idle → active → completed/errored). Falls back to stream lifecycle tracking when no tasks are detected.
- **opts.tasks:** Pass additional `TaskState` stores so `status` reflects work outside `task()`-wrapped steps (e.g. UI demos that run `taskState` manually). Duplicates are deduped with auto-detected task states. Note: `destroy()` does NOT destroy externally provided `opts.tasks` — the caller owns their lifecycle.
- **Destroy ownership:** `destroy()` tears down subscriptions, destroys auto-detected `task()` states, and invalidates approval controls. Externally provided `opts.tasks` are left alive since the caller owns them.
- **Branch support:** Use `branch()` steps with compound deps like `"validate.fail"` for conditional routing.

## See Also

- [task](./task) — value-level step
- [branch](./branch) — conditional routing
- [step](./pipeline) — expert-level step
