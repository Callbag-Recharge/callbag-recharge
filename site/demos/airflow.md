---
title: "Airflow in TypeScript"
outline: false
---

<style>
/* Full-width demo layout — override VitePress content max-width */
.vp-doc.has-aside .content-container,
.vp-doc .content-container {
  max-width: 100% !important;
}
.vp-doc.has-aside .content,
.vp-doc .content {
  max-width: 1200px !important;
  padding: 0 24px;
}
</style>

# Airflow in TypeScript

A personal finance pipeline built entirely with callbag-recharge primitives.
No external scheduler. No job queue. Just **reactive state management**.

Click **Run Pipeline** and hover over nodes to see real-time status, duration, circuit breaker state, and task logs.

<ClientOnly>
  <AirflowDemo />
</ClientOnly>

## What's happening

The pipeline executes a DAG of 7 tasks:

1. **Cron Trigger** kicks off the pipeline
2. **Fetch Bank** and **Fetch Cards** run in parallel (diamond source)
3. **Aggregate** waits for both to complete (diamond resolution via `combine()`)
4. **Detect Anomaly** and **Batch Write** fork from aggregate
5. **Send Alert** fires only if anomaly detection succeeds

The entire DAG is wired declaratively with `pipeline()` + `step()`. Each task is a
`taskState()` wrapped with a `circuitBreaker()` and a `reactiveLog()`.
Tasks randomly fail ~15-20% of the time — when they do, the circuit breaker tracks
failures and opens after 3 consecutive errors, with `exponential()` backoff for cooldown.

## Primitives used

| Primitive | From | Role |
|---|---|---|
| `pipeline()` + `step()` | `callbag-recharge/orchestrate` | Declarative DAG wiring with topological sort |
| `fromTrigger()` | `callbag-recharge/orchestrate` | Manual trigger entry point |
| `taskState()` | `callbag-recharge/orchestrate` | Tracks status, duration, runCount, error per task |
| `circuitBreaker()` | `callbag-recharge/utils` | Failure isolation with exponential cooldown |
| `reactiveLog()` | `callbag-recharge/data` | Bounded append-only log per task |
| `combine()` | `callbag-recharge/extra` | Diamond resolution — waits for all sources |
| `exponential()` | `callbag-recharge/utils` | Backoff strategy for circuit breaker |

All of these are tree-shakeable. Import only what you use.
