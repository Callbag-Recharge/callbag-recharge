# loop()

Creates a declarative iteration step in a pipeline. Repeats a sub-graph
until the predicate returns true.

Each iteration creates a fresh child pipeline from the factory, runs it to
completion, and checks the predicate against the output step's value. The
factory receives the previous iteration's output (or the original dep values
on the first iteration), enabling iterative refinement.

## Signature

```ts
function loop<T>(
	deps: string[],
	factory: (...values: any[]) => LoopDef<T>,
	opts?: LoopOpts,
): LoopStepDef<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `deps` | `string[]` | Names of upstream steps whose values are passed to the factory on the first iteration. |
| `factory` | `(...values: any[]) =&gt; LoopDef&lt;T&gt;` | Function receiving values (dep values on first iteration, previous output thereafter), returns a `LoopDef` describing the child pipeline and termination condition. |
| `opts` | `LoopOpts` | Optional configuration (name, maxIterations). |

## Returns

`LoopStepDef&lt;T&gt;` — step definition for pipeline() with task tracking.

## Basic Usage

```ts
import { pipeline, step, task, loop, fromTrigger } from 'callbag-recharge/orchestrate';

// Double a number until it reaches 100
const wf = pipeline({
    trigger: step(fromTrigger<number>()),
    iterate: loop(["trigger"], (n) => ({
          steps: {
            double: task([], async () => n * 2),
          },
        output: "double",
        predicate: (v) => v >= 100,
      })),
});
```

## Options / Behavior Details

- **Fresh pipeline:** Each iteration creates and destroys a child pipeline. No state leaks between iterations.
- **Iteration values:** On iteration 0, factory receives the original dep values. On iteration 1+, factory receives a single argument: the previous iteration's output value. Design your factory accordingly (e.g., use a single-argument signature with iteration-aware logic).
- **Predicate:** `predicate(value, iteration)` — return true to stop and emit the value.
- **Safety:** `maxIterations` (default 100) prevents infinite loops. Exceeding it errors via taskState.
- **Re-trigger:** New upstream values cancel the current iteration loop (switchMap semantics).
