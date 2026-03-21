# sensor()

Creates a sensor step that polls an external condition until it returns true,
then forwards the upstream value. Implements the Airflow sensor pattern.

## Signature

```ts
function sensor<T>(
	dep: string,
	poll: (value: T) => boolean | Promise<boolean>,
	opts?: SensorOpts,
): SensorStepDef<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `dep` | `string` | Name of the upstream step. |
| `poll` | `(value: T) =&gt; boolean | Promise&lt;boolean&gt;` | Function that receives the dep value and returns true when the condition is met. May be async. |
| `opts` | `SensorOpts` | Optional configuration (interval, timeout, name). |

## Returns

`SensorStepDef&lt;T&gt;` — step definition for pipeline() with task tracking.

## Basic Usage

```ts
import { pipeline, step, task, sensor, fromTrigger } from 'callbag-recharge/orchestrate';

// Poll every 3s until file is ready, then process
const wf = pipeline({
    trigger: step(fromTrigger<string>()),
    ready:   sensor("trigger", async (path) => {
        const res = await fetch(`/api/status/${path}`);
        return (await res.json()).ready;
      }, { interval: 3000, timeout: 60000 }),
  process: task(["ready"], async (path) => handle(path)),
});
```

## Options / Behavior Details

- **Polling:** Calls `poll(value)` every `interval` ms (default 5000). Stops on first truthy return.
- **Timeout:** If `timeout` is set and the condition is not met within that time, the task errors.
- **Re-trigger:** New upstream values cancel the current polling loop (switchMap semantics).
- **Passthrough:** On success, emits the upstream value (not the poll result).
