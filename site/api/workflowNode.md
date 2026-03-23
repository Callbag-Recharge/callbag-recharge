# workflowNode()

Create a workflow node with log, circuit breaker, and simulation helper.

## Signature

```ts
function workflowNode(
	id: string,
	label: string,
	opts?: WorkflowNodeOpts,
): WorkflowNodeResult
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` |  |
| `label` | `string` |  |
| `opts` | `WorkflowNodeOpts` |  |

## Basic Usage

```ts
const node = workflowNode("extract", "Extract Data");
// Use in a pipeline task:
const extractDef = task(["trigger"], async (_signal) => {
    node.log.append("[START] Extracting...");
    return node.simulate([300, 1000], 0.1);
  });
```
