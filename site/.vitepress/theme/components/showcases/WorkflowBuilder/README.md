# H3: Workflow Builder

Code-first n8n. Left: CodeMirror editor with `pipeline()` code. Right: live DAG (Vue Flow). Press "Update" to parse code into a visual graph. Fire triggers, watch nodes animate, inspect logs, execution history persists to IndexedDB.

## Files (planned)

- `store.ts` — `pipeline`, `step`, `task`, `branch`, `taskState`, `executionLog`, `circuitBreaker`, `fromTrigger`, `dag`, `checkpoint`
- `WorkflowBuilder.vue` — CodeMirror editor, Vue Flow DAG, trigger controls, log panel
