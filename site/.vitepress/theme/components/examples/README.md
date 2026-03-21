# Code Examples

Interactive demos with a GUI + highlighted source panel. Embedded in doc pages so builders can see exactly how to use each primitive.

Each example is a directory with:
- `pipeline.ts` or `store.ts` — pure library code with `#region display` / `#endregion display` markers for the source panel.
- `<Name>.vue` — Vue component with split-pane: interactive GUI on top, highlighted source below. Bridges to library stores via `subscribe()`. Hover/run interactions highlight corresponding source lines.

## Current

| Dir | Example | Status |
|-----|---------|--------|
| `AirflowPipeline/` | DAG execution, diamond resolution, circuit breaker, retry | Shipped (D1) |
| `FormBuilder/` | `formField` pattern, sync + async validation, derived aggregation | Planned (D2) |
| `AgentLoop/` | `agentLoop` + `gate` + `approval`, tool call cycle | Planned (D3) |
| `RealtimeDashboard/` | `reactiveMap` + `reactiveLog`, live aggregation, sampling | Planned (D4) |
| `StateMachine/` | `stateMachine` util, typed transitions, graph rendering | Planned (D5) |
| `CompatComparison/` | Same counter/todo in callbag-recharge vs Jotai vs Zustand vs Signals | Planned (D6) |
