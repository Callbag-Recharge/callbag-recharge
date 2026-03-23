# H3: Workflow Builder

Code-first n8n. Left: CodeMirror shows pipeline code. Right: live DAG (Vue Flow). Users pick from pipeline templates, customize parameters (duration, failure rate), fire triggers, watch nodes animate, inspect logs.

## Store layer (done)

`examples/workflow-builder.ts` — `createWorkflowBuilder()` factory + `templates` registry.

**Template-based approach** (not eval): Users select from pre-built pipeline templates. Each template provides display code (shown in CodeMirror) and a `build()` factory that creates the live pipeline. Templates:
1. **ETL** — Extract → Transform → Load (linear 3-stage)
2. **Fan-out / Fan-in** — Ingest → (Validate ‖ Enrich) → Store (diamond)
3. **Full DAG** — 7-node finance pipeline with circuit breakers, skip propagation

**Primitives used:** `pipeline`, `task`, `source`, `fromTrigger`, `state`, `derived`, `effect`, `circuitBreaker`, `exponential` (backoff), `reactiveLog`, `firstValueFrom`, `fromTimer`.

**Exported interface:**
- `selectedTemplate` — current template ID
- `code` — pipeline code displayed in editor
- `durationRange`, `failRate` — configurable simulation params
- `running`, `runCount` — pipeline execution state
- `pipelineStatus` — `"idle" | "active" | "completed" | "errored"`
- `nodes` — `WorkflowNode[]` for Vue Flow (id, label, task status, log, breaker)
- `edges` — `WorkflowEdge[]` for Vue Flow
- `executionLog` — global `ReactiveLog<string>`
- `selectTemplate(id)`, `trigger()`, `reset()`, `destroy()`

## TDD tests (done)

`src/__tests__/showcases/workflow-builder.test.ts` — 23 tests covering:
- Template registry (count, required fields, unique IDs)
- DAG structure per template (node/edge count, edge pairs)
- Template switching (selected template, code, nodes/edges, status reset)
- Trigger and status (running flag, no-op while running, completion transitions)
- Reset (returns to idle, re-trigger works)
- Execution log (appends on trigger, records template name)
- Node metadata (task with status store, log, circuit breaker)
- Code display (contains pipeline/task keywords)
- Destroy cleanup

## Vue component (next)

`WorkflowBuilder.vue` — CodeMirror (read-only code display), Vue Flow (DAG), template selector dropdown, parameter sliders, trigger/reset buttons, log panel. UI-only; imports from `@examples/workflow-builder`.

### Adding new templates

Add to the `templates` array in `workflow-builder.ts`:
1. Create a `buildXxxPipeline(opts)` function with node metadata + pipeline wiring
2. Add a `PipelineTemplate` entry with `id`, `name`, `description`, `code` (display), and `build` factory
