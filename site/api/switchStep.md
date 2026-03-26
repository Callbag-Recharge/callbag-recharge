# switchStep()

Creates an N-way conditional routing step in a pipeline. Each case becomes
a compound step accessible as `"stepName.caseName"`.

## Signature

```ts
function switchStep<T>(
	dep: string,
	dispatcher: (value: T) => string | undefined,
	cases: readonly string[],
	opts?: { name?: string },
): SwitchStepDef<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `dep` | `string` | Name of the upstream step to route on. |
| `dispatcher` | `(value: T) =&gt; string | undefined` | Function that maps a value to a case name (must be one of `cases`).
Return `undefined` to suppress the value (no case receives it). |
| `cases` | `readonly string[]` | Array of case name strings. |
| `opts` | `{ name?: string }` | Optional configuration. |

## Returns

`SwitchStepDef&lt;T&gt;` — step definition for pipeline(). Each case is
accessible as `"stepName.caseName"` in downstream step deps.

## Basic Usage

```ts
import { pipeline, source, task, switchStep, fromTrigger } from 'callbag-recharge/orchestrate';

const wf = pipeline({
    input:   source(fromTrigger<number>()),
    route:   switchStep("input", v => v > 0 ? "positive" : v < 0 ? "negative" : "zero",
      ["positive", "negative", "zero"]),
    pos:     task(["route.positive"], async (signal, [v]) => `pos: ${v}`),
    neg:     task(["route.negative"], async (signal, [v]) => `neg: ${v}`),
    zero:    task(["route.zero"], async (signal, [v]) => `zero: ${v}`),
  });
```

## Options / Behavior Details

- **Diamond-safe:** All case outputs use `operator()` with RESOLVED signaling
on inactive branches to prevent blocking downstream diamond joins.
