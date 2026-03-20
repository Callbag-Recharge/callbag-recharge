# Orchestrate

Workflow scheduling, pipelines, triggers, and durable execution primitives. Specialized domain for building reactive DAG-based task pipelines ("Airflow in TypeScript").

Key principle: `derived()` + `effect()` with explicit deps IS the DAG executor — diamond resolution guarantees correct ordering. No separate scheduling engine needed.

Modules include: `fromCron`, `fromTrigger`, `taskState`, `dag`, `pipeline`, `step`, `checkpoint`, `executionLog`, `gate`, `track`, `route`, `withBreaker`, `withRetry`, `withTimeout`, `tokenTracker`.

Imports from `core/`, `extra/`, `utils/`, and `data/`.
