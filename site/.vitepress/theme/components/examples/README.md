# Interactive Demo Components

Vue components that render interactive GUIs for the demo pages on the site.

**All library logic lives in `examples/` at the repo root** — Vue components here handle UI only and import stores via `@examples/<name>`.

Each demo is a directory with:
- `<Name>.vue` — Vue component with split-pane: interactive GUI on top, highlighted source below. Bridges to library stores via `subscribe()`. Hover/run interactions highlight corresponding source lines.

Store code uses `#region display` / `#endregion display` markers in the `examples/` file for the source panel extraction.

## Current

| Dir | Example file | Status |
|-----|-------------|--------|
| `AirflowPipeline/` | `examples/airflow-demo.ts` | Shipped (D1) |
| `FormBuilder/` | `examples/form-with-editor.ts` | Planned (D2) |
| `AgentLoop/` | `examples/tool-calls.ts` | Planned (D3) |
| `RealtimeDashboard/` | `examples/real-time-dashboard.ts` | Planned (D4) |
| `StateMachine/` | — | Planned (D5) |
| `CompatComparison/` | — | Planned (D6) |
