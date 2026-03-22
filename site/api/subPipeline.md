# subPipeline()

Creates a nested pipeline invocation step. Each trigger creates a fresh
child pipeline, runs it to completion, and emits the output step's value.
Previous child pipelines are destroyed on re-trigger (switchMap semantics).

## Signature

```ts
function subPipeline<T>(
	deps: string[],
	factory: (signal: AbortSignal, values: any[]) => SubPipelineDef,
	opts?: SubPipelineOpts,
): SubPipelineStepDef<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deps` | `string[]` | Names of upstream steps whose values are passed to the factory. |
| `factory` | `(signal: AbortSignal, values: any[]) =&gt; SubPipelineDef` | Function receiving `(signal, values)`. Signal is aborted on reset/destroy. Values is an array of dep values. Returns a `SubPipelineDef` describing the child pipeline. |
| `opts` | `SubPipelineOpts` | Optional configuration (name). |

## Returns

`SubPipelineStepDef&lt;T&gt;` — step definition for pipeline() with task tracking.

## Basic Usage

```ts
import { pipeline, step, task, subPipeline, fromTrigger } from 'callbag-recharge/orchestrate';

const wf = pipeline({
    trigger: step(fromTrigger<string>()),
    sub: subPipeline(["trigger"], (url) => ({
          steps: {
            fetch:   task([], async () => {
                const res = await fetch(url);
                return res.json();
              }),
          process: task(["fetch"], async (data) => transform(data)),
        },
      output: "process",
    })),
});
```

## Options / Behavior Details

- **Lifecycle:** Every child pipeline created is guaranteed to be destroyed — either on re-trigger or parent destroy.
- **Output:** The `output` field in `SubPipelineDef` specifies which child step's value to emit. Defaults to the last step in topological order.
- **Task tracking:** Internal `taskState` tracks child pipeline execution. Pipeline auto-detects it for aggregate status.
