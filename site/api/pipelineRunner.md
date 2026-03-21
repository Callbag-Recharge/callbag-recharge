# pipelineRunner()

Supervisor for long-running pipelines. Creates, monitors, and auto-restarts
pipelines on failure. Provides aggregate health status.

## Signature

```ts
function pipelineRunner(configs: PipelineRunnerConfig[]): PipelineRunnerResult
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `configs` | `PipelineRunnerConfig[]` | Array of pipeline configurations to manage. |

## Returns

`PipelineRunnerResult` — managed pipelines, aggregate status, lifecycle controls.

## Basic Usage

```ts
import { pipelineRunner } from 'callbag-recharge/orchestrate';
import { pipeline, step, task, fromTrigger } from 'callbag-recharge/orchestrate';
import { exponential } from 'callbag-recharge/utils';

const runner = pipelineRunner([
    {
      name: "ingest",
      factory: () => pipeline({
          trigger: step(fromTrigger<string>()),
          fetch: task(["trigger"], async (url) => fetch(url).then(r => r.json())),
        }),
    restart: { backoff: exponential({ base: 1000 }) },
  },
]);

runner.status.get(); // "running"
runner.destroy();
```
