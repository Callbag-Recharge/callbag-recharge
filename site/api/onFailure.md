# onFailure()

Creates a dead letter / error routing step. Activates when the upstream
task's error companion store emits a non-undefined value (terminal failure
after retries exhausted).

Pipeline auto-registers `"stepName.error"` for any `task()` step, so
`onFailure` resolves its dep to the task's error companion store.

## Signature

```ts
function onFailure<T>(
	dep: string,
	handler: (signal: AbortSignal, error: unknown) => T | Promise<T>,
	opts?: OnFailureOpts,
): OnFailureStepDef<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `dep` | `string` | Name of the upstream task step to watch for failures. |
| `handler` | `(signal: AbortSignal, error: unknown) =&gt; T | Promise&lt;T&gt;` | Function receiving `(signal, error)`. Signal is aborted on reset/destroy. Returns a value for downstream steps. |
| `opts` | `OnFailureOpts` | Optional configuration (name). |

## Returns

`OnFailureStepDef&lt;T&gt;` — step definition for pipeline() with task tracking.

## Basic Usage

```ts
import { pipeline, step, task, onFailure, fromTrigger } from 'callbag-recharge/orchestrate';

const wf = pipeline({
    trigger: step(fromTrigger<string>()),
    fetch:   task(["trigger"], async (v) => fetchData(v), { retry: 3 }),
    dlq:     onFailure("fetch", async (error) => {
        await logToDeadLetterQueue({ error, timestamp: Date.now() });
        return { handled: true };
      }),
});
```

## Options / Behavior Details

- **Activation:** Only fires when the dep step errors (error store transitions to non-undefined).
- **Re-trigger:** If the dep step errors again (after reset + re-run), the handler re-fires (switchMap cancels any in-flight handler).
- **Task tracking:** Internal `taskState` tracks handler execution. Pipeline auto-detects it for aggregate status.
