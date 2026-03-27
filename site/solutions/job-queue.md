---
outline: deep
---

# Job Queue

Run background jobs with controlled concurrency, retry behavior, and reactive observability.

## What it is

Job Queue is a queue processor built on topic + subscription primitives. Producers enqueue data; workers process jobs with lifecycle events and progress tracking.

## When to use it

- Background processing (emails, webhooks, indexing, enrichment).
- Worker pools with configurable concurrency.
- Workloads requiring failure handling, retries, and stall detection.

## When not to use it

- Broadcast event streams where each consumer should see every event.
- Complex DAG workflow coordination across many dependent steps.

For those cases, prefer:

- `topic()` + one `subscription()` per consumer group/app for true fan-out broadcast.
- `pipeline()` + `task()` (Orchestrate) when dependencies and graph control are primary.

## Core primitives

- `jobQueue()` for queue processing and worker lifecycle.
- `topic()` as enqueue storage backbone.
- `subscription()` for consumer state and pull/ack behavior.

## Typical usage flow

1. Define a `jobQueue` with your processor callback.
2. Enqueue jobs via `add(data)`.
3. Handle progress/completion/failure events.
4. Tune concurrency/retry settings and monitor queue health stores.

## Start here

- API:
  - [jobQueue()](/api/jobQueue)
  - [topic()](/api/topic)
  - [subscription()](/api/subscription)
- Recipes:
  - [Job Queue](/recipes/job-queue)
  - [Airflow-Style Pipeline](/recipes/airflow-pipeline)
