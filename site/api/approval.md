# approval()

Creates a human-in-the-loop approval step in a pipeline. Values from the
upstream dep are queued until explicitly approved, rejected, or modified.

The returned step definition exposes `approve()`, `reject()`, `modify()`,
`open()`, and `close()` controls. In a pipeline result, access them via
`wf.steps.review` (where "review" is the step name).

## Signature

```ts
function approval<T>(dep: string, opts?: ApprovalOpts): ApprovalStepDef<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `dep` | `string` | Name of the upstream step to gate. |
| `opts` | `ApprovalOpts` | Optional configuration (maxPending, startOpen, name). |

## Returns

`ApprovalStepDef&lt;T&gt;` — step definition for pipeline() with approval controls.

## Basic Usage

```ts
import { pipeline, step, task, approval, fromTrigger } from 'callbag-recharge/orchestrate';

const wf = pipeline({
    input:   step(fromTrigger<string>()),
    review:  approval("input"),
    process: task(["review"], async (v) => saveToDb(v)),
  });

// Values queue at the review step
wf.steps.input.fire("draft-1");
wf.steps.review.pending.get(); // ["draft-1"]

// Approve to let it flow to process
wf.steps.review.approve();
```

## Options / Behavior Details

- **Queue:** Values queue while gate is closed. `maxPending` limits queue size (FIFO drop).
- **Open/close:** `open()` flushes all pending and auto-approves. `close()` re-enables manual gating.
- **Destroy:** After `pipeline.destroy()`, all controls and store accessors throw. This prevents stale references from silently no-oping on a torn-down gate.
