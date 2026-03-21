# toD2()

Serialize a pipeline's step-level DAG to D2 diagram syntax.

## Signature

```ts
function toD2(steps: Record<string, StepDef>, opts?: D2Opts): string
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `steps` | `Record&lt;string, StepDef&gt;` | The step definitions record (same object passed to `pipeline()`). |
| `opts` | `D2Opts` | Optional direction and runtime status source. |

## Returns

D2 diagram string.

## Basic Usage

```ts
import { pipeline, step, task, toD2, fromTrigger } from 'callbag-recharge/orchestrate';

const steps = {
  trigger: step(fromTrigger<string>()),
  fetch:   task(["trigger"], async (v) => fetchData(v)),
};
console.log(toD2(steps));
// direction: down
//
// trigger: "trigger (source)" { shape: oval }
// fetch: "fetch (task)" { shape: rectangle }
//
// trigger -> fetch
```

## Options / Behavior Details

- **Step types:** Detected automatically — source, task, branch, step.
Different shapes per type (oval for source, diamond for branch, rectangle for others).
- **Runtime status:** Pass a running `PipelineResult` via `opts.status` to
add status annotations to node labels.
