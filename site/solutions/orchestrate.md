---
outline: deep
---

# Orchestrate

Build reactive workflows as a typed DAG where control and status stay inside the graph.

## What it is

Orchestrate is the workflow layer for callbag-recharge. You define steps, dependencies, and task logic declaratively, then run everything with built-in lifecycle and status tracking.

## When to use it

- Multi-step workflows where later steps depend on earlier outputs.
- AI/agent pipelines with branch + approval + retry requirements.
- Long-running flows that need pause/resume/reset behavior.

## When not to use it

- Single isolated async operation with no dependency graph.
- Simple event pub/sub where no DAG coordination is needed.

## Core primitives

- `pipeline()` for DAG assembly and orchestration lifecycle.
- `task()` for signal-first async work steps.
- `branch()` and `wait()` for conditional and control flow.
- `sensor()` for external state/reactivity inputs.

## Typical usage flow

1. Define a trigger/source step.
2. Add `task()` steps with explicit dependencies.
3. Add conditional routing (`branch`) or gating as needed.
4. Fire the source and observe pipeline status and step outputs.

## Start here

- API:
  - [pipeline()](/api/pipeline)
  - [task()](/api/task)
  - [branch()](/api/branch)
  - [wait()](/api/wait)
  - [sensor()](/api/sensor)
- Recipes:
  - [Airflow-Style Pipeline](/recipes/airflow-pipeline)
  - [Cron Pipeline](/recipes/cron-pipeline)
  - [Hybrid Cloud+Edge Routing](/recipes/hybrid-routing)
