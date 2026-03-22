---
outline: deep
---

# Airflow-Style Pipeline

Build a declarative workflow pipeline with `pipeline()` + `step()` — conditional routing, human approval gates, retry, circuit breakers, and checkpointing.

## The Problem

Workflow engines like Airflow and n8n require external schedulers and job queues. This recipe shows how to build the same DAG-based execution model entirely in-process using callbag-recharge's orchestration primitives.

## The Solution

<<< @/../examples/airflow-pipeline.ts

## Interactive Demo

See the [interactive Airflow demo](/demos/airflow) for a visual DAG with real-time status, duration, and circuit breaker state.

## Primitives Used

| Primitive | From | Role |
|---|---|---|
| `pipeline()` + `step()` | `callbag-recharge/orchestrate` | Declarative DAG wiring |
| `fromTrigger()` | `callbag-recharge/orchestrate` | Manual trigger entry point |
| `route()` | `callbag-recharge/orchestrate` | Conditional branching |
| `gate()` | `callbag-recharge/orchestrate` | Human approval gate |
| `track()` | `callbag-recharge/orchestrate` | Step metadata tracking |
| `withRetry()` | `callbag-recharge/orchestrate` | Automatic retry on failure |
| `withTimeout()` | `callbag-recharge/orchestrate` | Timeout guard |
| `withBreaker()` | `callbag-recharge/orchestrate` | Circuit breaker isolation |
| `checkpoint()` | `callbag-recharge/orchestrate` | Persistent state recovery |
| `circuitBreaker()` | `callbag-recharge/utils` | Failure threshold + cooldown |
| `firstValueFrom()` + `fromTimer()` | `callbag-recharge/extra` | Async delays (no raw setTimeout) |

## See Also

- [Cron Pipeline](./cron-pipeline) — scheduled pipeline with `fromCron`
- [Interactive Demo](/demos/airflow) — visual DAG execution
