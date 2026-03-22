# jobFlow()

Chain multiple job queues into a workflow. When a job completes in a source
queue, its result is published to the destination queue (optionally transformed).

## Signature

```ts
function jobFlow(
	queues: Record<string, JobQueue<any, any>>,
	edges: JobFlowEdge[],
	opts?: JobFlowOptions,
): JobFlow
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `queues` | `Record&lt;string, JobQueue&lt;any, any&gt;&gt;` | Named record of job queues. |
| `edges` | `JobFlowEdge[]` | Wiring edges describing which queue outputs feed into which queue inputs. |
| `opts` | `JobFlowOptions` | Optional configuration (name). |

## Returns

`JobFlow` — a multi-queue workflow with diagram export and lifecycle.
