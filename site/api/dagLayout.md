# dagLayout()

Compute a layered DAG layout using Sugiyama-style algorithm.

Handles cycles gracefully: back-edges are detected via DFS and excluded
from layer assignment. They are returned in `result.backEdges` so renderers
can draw them as dashed/curved arrows indicating loops.

## Signature

```ts
function dagLayout(
	nodes: { id: string }[],
	edges: DagLayoutEdge[],
	opts?: DagLayoutOpts,
): DagLayoutResult
```

## Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `nodes` | `{ id: string }[]` |  |
| `edges` | `DagLayoutEdge[]` |  |
| `opts` | `DagLayoutOpts` |  |

## Returns

`DagLayoutResult` with positioned nodes and detected back-edges.

## Basic Usage

```ts
const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
const edges = [
  { source: "a", target: "b" },
  { source: "b", target: "c" },
  { source: "c", target: "a" }, // cycle!
];
const result = dagLayout(nodes, edges);
// result.nodes — positioned layout (a → b → c layered)
// result.backEdges — [{ source: "c", target: "a" }]
```
