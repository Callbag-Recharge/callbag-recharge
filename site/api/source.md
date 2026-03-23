# source()

Declares an event source step for `pipeline()`. Sources are long-lived emitters
(triggers, cron, WebSocket, etc.) that never block pipeline completion.

Use `source()` for entry points and `task()` for work steps. Together they
cover all pipeline node types — `step()` is internal plumbing.

## Signature

```ts
function source<T>(store: Store<T>, opts?: { name?: string }): StepDef<T>
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `store` | `Store&lt;T&gt;` | A reactive store (e.g., `fromTrigger()`, `fromCron()`, `interval()`). |
| `opts` | `{ name?: string }` | Optional configuration. |

## Returns

`StepDef&lt;T&gt;` — step definition tagged as a source for pipeline().

## Basic Usage

```ts
import { source, task, fromTrigger, pipeline } from 'callbag-recharge/orchestrate';

const wf = pipeline({
    trigger: source(fromTrigger<string>()),
    fetch:   task(["trigger"], async (signal, [v]) => fetchData(v)),
  });
```
