---
title: "Workflow Builder"
outline: false
---

<style>
.VPDoc .container { max-width: 1200px; }
</style>

# Workflow Builder

<ClientOnly>
  <WorkflowBuilder />
</ClientOnly>

## What's happening

A code-first workflow tool: pick a pipeline template, customize parameters, fire triggers, and watch nodes execute in real-time.

**Template selector:** Choose from 3 built-in pipeline templates — each demonstrates a different DAG topology (linear, diamond, full graph). Templates are defined as code factories using `pipeline()` + `task()`.

**DAG visualization:** Vue Flow renders the pipeline graph with auto-layout via `dagLayout()` (Sugiyama-style layered algorithm). Nodes animate with status colors and glowing edges. Hover any node for a popover with status, circuit breaker state, and log tail.

**Parameter controls:** Adjust simulation duration and failure rate in real-time. Higher failure rates trigger circuit breakers, which skip downstream tasks.

**Execution log:** Every trigger and completion is logged reactively via `reactiveLog()`.

## Primitives used

- **`pipeline()`** — Orchestrate: topological DAG wiring with auto-detection
- **`task()`** — Orchestrate: async task with status tracking + circuit breaker skip
- **`workflowNode()`** — Orchestrate: bundled node with log + circuit breaker + simulation
- **`dagLayout()`** — Orchestrate: Sugiyama-style layered DAG layout algorithm
- **`fromTrigger()`** — Source: imperative fire → reactive emission
- **`reactiveLog()`** — Data: append-only bounded log with reactive tail
- **`circuitBreaker()`** — Utils (via workflowNode): failure threshold → open → cooldown
