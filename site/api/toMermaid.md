# toMermaid()

Serialize a pipeline's step-level DAG to Mermaid flowchart syntax.

## Signature

```ts
function toMermaid(steps: Record<string, StepDef>, opts?: MermaidOpts): string
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `steps` | `Record&lt;string, StepDef&gt;` | The step definitions record (same object passed to `pipeline()`). |
| `opts` | `MermaidOpts` | Optional direction and runtime status source. |

## Returns

Mermaid flowchart string.

## Basic Usage

```ts
import { pipeline, step, task, toMermaid, fromTrigger } from 'callbag-recharge/orchestrate';

const steps = {
  trigger: step(fromTrigger<string>()),
  fetch:   task(["trigger"], async (v) => fetchData(v)),
};
const wf = pipeline(steps);
console.log(toMermaid(steps));
// graph TD
//   trigger["trigger (source)"]
//   fetch["fetch (task)"]
//   trigger --> fetch
```

## Options / Behavior Details

- **Step types:** Detected automatically — source (no deps), task (has taskState),
branch (has _failStore), step (generic). Shown in node labels.
- **Runtime status:** Pass a running `PipelineResult` via `opts.status` to add
status-based CSS classes to nodes (idle, active, completed, errored).
- **Branch support:** Branch steps auto-include their `.fail` companion node.
