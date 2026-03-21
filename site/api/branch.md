# branch()

Creates a binary conditional branch in a pipeline. The step itself outputs
matching values; the `.fail` branch is accessible as `"stepName.fail"`.

## Signature

```ts
function branch<T>(
	dep: string,
	predicate: (value: T) => boolean,
	opts?: { name?: string },
): BranchStepDef<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `dep` | `string` | Name of the upstream step to branch on. |
| `predicate` | `(value: T) =&gt; boolean` | Function that returns `true` for matching (pass) values. |
| `opts` | `{ name?: string }` | Optional configuration. |

## Returns

`BranchStepDef&lt;T&gt;` — step definition for pipeline(). The matching branch
is the step itself; `"stepName.fail"` is auto-registered by pipeline().

## Basic Usage

```ts
import { pipeline, step, task, branch, fromTrigger } from 'callbag-recharge/orchestrate';

const wf = pipeline({
    input:    step(fromTrigger<number>()),
    check:    branch("input", v => v > 0),
    positive: task(["check"], async (v) => `good: ${v}`),
    negative: task(["check.fail"], async (v) => `bad: ${v}`),
  });
```

## Options / Behavior Details

- **Diamond-safe:** Both outputs use `route()` internally, with suppression signaling
on the inactive branch to prevent blocking downstream diamond joins.
