# wait()

Creates an intentional pause step in a pipeline.

**Duration mode:** `wait(dep, ms)` — delays forwarding the dep value by `ms` milliseconds.

**Signal mode:** `wait(dep, signalStore)` — holds the dep value until `signalStore` emits
a truthy value, then forwards immediately.

New upstream values cancel any pending wait (switchMap re-trigger cancellation).

## Signature

```ts
function wait<T>(
	dep: string,
	durationOrSignal: number | Store<any>,
	opts?: WaitOpts,
): StepDef<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `dep` | `string` | Name of the upstream step. |
| `durationOrSignal` | `number | Store&lt;any&gt;` | Milliseconds to wait, or a `Store` whose truthy emission triggers forwarding. |
| `opts` | `WaitOpts` | Optional configuration (name). |

## Returns

`StepDef&lt;T&gt;` — step definition for pipeline().

## Basic Usage

```ts
import { pipeline, step, task, wait, fromTrigger } from 'callbag-recharge/orchestrate';

// Duration mode: 5 second cooldown
const wf = pipeline({
    trigger: step(fromTrigger<string>()),
    pause:   wait("trigger", 5000),
    process: task(["pause"], async (v) => handle(v)),
  });

// Signal mode: wait for external readiness
const ready = state(false);
const wf2 = pipeline({
    trigger: step(fromTrigger<string>()),
    pause:   wait("trigger", ready),
    process: task(["pause"], async (v) => handle(v)),
  });
ready.set(true); // releases the wait
```

## Options / Behavior Details

- **Distinct from timeout():** timeout() is a guard that fails on expiry. wait() always forwards.
- **Distinct from gate():** gate() requires human approval. wait() is automatic.
- **Re-trigger:** New dep values cancel any pending wait (switchMap semantics).
