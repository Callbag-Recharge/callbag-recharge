---
outline: deep
---

# Messaging

Model event-driven systems with append-only topics and reactive subscriptions.

## What it is

Messaging provides durable topic streams plus consumer semantics for fan-out processing, replay, and backpressure-aware handling.

## When to use it

- Event-driven architectures with multiple independent consumers.
- Pipelines that require replay or sequence-aware processing.
- Systems needing bounded logs, compaction, and topic-level isolation.

## When not to use it

- Tight DAG orchestration where step dependencies are primary.
- In-memory local state updates without message semantics.

## Core primitives

- `topic()` for append-only streams.
- `subscription()` for tracked consumers and offsets.
- `repeatPublish()` for retries/re-delivery workflows.
- `jobFlow()` when stream processing and job semantics overlap.

## Typical usage flow

1. Define a `topic` for your domain events.
2. Create one or more `subscription` consumers.
3. Process and commit messages, or retry with policies.
4. Monitor stream growth and consumer lag through companion stores.

## Start here

- API:
  - [topic()](/api/topic)
  - [subscription()](/api/subscription)
  - [repeatPublish()](/api/repeatPublish)
  - [jobFlow()](/api/jobFlow)
- Recipes:
  - [Tool Calls for Local LLMs](/recipes/tool-calls)
  - [Reactive Data Pipeline](/recipes/data-pipeline)
