# join()

Creates a data-merge pipeline step. Joins arrays from multiple upstream deps
using configurable strategies: append (concatenate), merge-by-key (full outer
join), or intersect (inner join).

## Signature

```ts
function join<T>(
	deps: string[],
	strategy: JoinStrategy<T>,
	opts?: JoinOpts,
): JoinStepDef<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deps` | `string[]` | Names of upstream steps (must each emit `T[]`). Requires 2+. |
| `strategy` | `JoinStrategy&lt;T&gt;` | `"append"`, `{ merge: keyFn }`, or `{ intersect: keyFn }`. |
| `opts` | `JoinOpts` | Optional configuration (name). |

## Returns

`JoinStepDef&lt;T&gt;` — step definition for pipeline() with task tracking.

## Basic Usage

```ts
import { pipeline, step, task, join, fromTrigger } from 'callbag-recharge/orchestrate';

const wf = pipeline({
    trigger: step(fromTrigger<void>()),
    users:  task(["trigger"], async () => [{ id: 1, name: "Alice" }]),
    scores: task(["trigger"], async () => [{ id: 1, score: 100 }]),
    merged: join(["users", "scores"], { merge: (item) => item.id }),
  });
// merged.get() → [{ id: 1, name: "Alice", score: 100 }]
```

## Options / Behavior Details

- **Requires 2+ deps.** For single-dep transforms, use `task()`.
- **Array inputs required.** All deps must emit arrays. Non-array or undefined values are skipped.
- **Re-trigger:** New upstream values cancel the previous computation (switchMap semantics).
- **Task tracking:** Internal `taskState` tracks status/duration/errors. Pipeline auto-detects it.
