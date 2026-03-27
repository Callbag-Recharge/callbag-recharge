---
outline: deep
---

# Solutions

Product-focused guides for standalone tools built on callbag-recharge.

Use this section when you want to decide *which building block to use* before diving into API details.

## Solution Matrix

| Solution | Best for | Core APIs | Start here |
|----------|----------|-----------|------------|
| [Orchestrate](./orchestrate) | DAG workflows, approvals, retries, and typed execution state | `pipeline`, `task`, `branch`, `wait`, `sensor` | [Orchestrate solution](./orchestrate) |
| [Messaging](./messaging) | Topic streams, fan-out consumers, replayable logs | `topic`, `subscription`, `repeatPublish`, `jobFlow` | [Messaging solution](./messaging) |
| [Job Queue](./job-queue) | Background processing with concurrency, retries, and lifecycle events | `jobQueue`, `topic`, `subscription` | [Job Queue solution](./job-queue) |

## How to choose

- Pick **Orchestrate** when work is graph-shaped and step dependencies matter.
- Pick **Messaging** when you need durable event streams and fan-out subscribers (each app/group sees its own stream).
- Pick **Job Queue** when you need competing pull-based workers where each job is processed once.

## Related Docs

- [API Reference](/api/state)
- [Recipes](/recipes/)
- [Architecture](/architecture/)
