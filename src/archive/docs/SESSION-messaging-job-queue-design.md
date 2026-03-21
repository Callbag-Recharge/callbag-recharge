# Session: Messaging & Job Queue Design — Pulsar-Inspired Topic System

**Date:** 2026-03-21
**Topic:** Can callbag-recharge build a job queue / message queue like RabbitMQ or BullMQ? Design exploration from first principles.

---

## KEY DISCUSSION

### Starting Point: "Can we build a job queue?"

Audit of existing primitives against job queue requirements. Found that nearly all building blocks already exist:

| Job queue concept | Existing primitive |
|---|---|
| Job processing | `task()` + `taskState` |
| Workflows / DAGs | `pipeline()` + `branch()` + `join()` |
| Fan-out / concurrency | `forEach` |
| Retry + backoff | `retry`, `backoff`, `circuitBreaker` |
| Dead letter queue | `onFailure` |
| Delayed jobs | `wait` |
| Persistence | `checkpoint` + `executionLog` adapters |
| Supervision | `pipelineRunner` |
| Cron triggers | `fromCron` |

### Priority Queue: reactiveIndex is NOT a fit

`reactiveIndex` is a reverse index (`indexKey → Set<primaryKey>`) — unordered Sets, no numeric comparison, no dequeue. Designed for tag-based lookups, not priority ordering.

**Decision:** Build a plain `PriorityQueue<T>` utility (array-backed heap) in `utils/`. Non-reactive — reactivity belongs at the job level (taskState companions), not the queue data structure level. Nobody derives from "the 3rd item in a priority queue."

### Distribution Research: Patterns for Reactive Systems

Online research surfaced key taxonomy:

1. **Don't distribute the reactive graph** — reactive programming (callbag, RxJS) is single-process. Bridge at edges via message transports (Redis, NATS, WebSocket). This is what Phase 7 adapters do.

2. **Competing consumers are not reactive-native** — reactive streams broadcast (one value → many subscribers). Competing consumers are unicast (one message → one worker). Solutions: external broker dispatch, custom `dispatch()` operator, or partition by key.

3. **Distributed locks: prefer sagas over locks** — Redlock has known issues. Saga pattern (compensating pipelines) fits naturally with existing `pipeline()` + `checkpoint()` + `onFailure()`. CALM theorem: monotonic operations need zero coordination.

4. **CRDTs for state sync** — CRDTs converge without coordination. LWW-Register covers 80% of cases. RxDB model (store operations, replay to compute state) fits callbag pipelines.

### CRDTs: Do We Need Them?

**Answer: No, not for job queues.**

NodeV0→V1→V2 progression is about identity/integrity/access control, not convergence:
- V0: `id` + `version` + `snapshot()` — serialization
- V1: `CID` + `prev` — content addressing, hash chain, fork detection
- V2: Capability tokens + refs — access control, subgraph replication

CRDTs solve concurrent mutation convergence — relevant for collaborative editing, not job queues. Job queues are an ownership/transport problem.

| Scenario | CRDTs needed? |
|---|---|
| Job queue | No — jobs are claimed, not merged |
| Workflow state | No — owned by one runner |
| Collaborative editing | Yes — multiple concurrent writers |
| Multi-agent shared memory | Maybe — depends on ownership model |
| Cross-tab sync | LWW suffices |

### Pulsar vs RabbitMQ: Which Model Fits?

**Pulsar, by a wide margin.**

Core alignment: Pulsar treats everything as a stream with cursors. RabbitMQ treats everything as a queue you drain. callbag-recharge is a stream system.

| Pulsar concept | callbag-recharge mapping |
|---|---|
| Topic (append-only stream) | `reactiveLog` |
| Subscription (cursor on stream) | cursor + `subscribe()` with backpressure |
| Pulsar Functions | `operator` / `task` |
| Exclusive subscription | Single `subscribe()` |
| Shared subscription | Competing consumer / `forEach` fan-out |
| Failover subscription | `pipelineRunner` auto-restart |
| Key_Shared subscription | `branch` / `groupBy` + per-key subscription |

**Key user insight:** "We can do pull (backpressure) + some persistence to mimic consumer demands." — This is exactly Pulsar's cursor model.

### Message Queue First, Job Queue Second

**Decision:** Build message queue as the lower-level primitive, then wrap as job queue.

```
messageQueue (topic + subscription)    jobQueue (thin wrapper)
┌──────────────────────────────┐      ┌──────────────────────┐
│ topic (reactiveLog-backed)   │      │ messageQueue          │
│ subscription (cursor-based)  │  →   │ + task() processing   │
│ ack/nack                     │      │ + taskState lifecycle  │
│ subscription modes           │      │ + onFailure/DLQ        │
│ backpressure                 │      │ + repeatable (fromCron) │
└──────────────────────────────┘      └──────────────────────┘
```

### Cross-Cutting Infrastructure: Generic Primitives

**Key realization:** Schema validation, namespacing, transactions, compaction, and tiered storage are NOT messaging-specific. They benefit orchestrate and memory equally.

```
              5d (utils/ + data/)
              ┌──────────────────────┐
              │ PriorityQueue        │
              │ withSchema           │
              │ namespace            │
              │ transaction          │
              │ compaction           │
              │ tieredStorage        │
              └──────┬───────────────┘
     ┌───────────────┼───────────────┐
     ▼               ▼               ▼
  messaging      orchestrate/      memory/
```

- **`withSchema`** — runtime validation via `{ parse }` contract (Zod/Valibot/ArkType). Used by topics, pipeline step I/O, adapters, memory collections.
- **`namespace`** — scoped naming for multi-tenancy. Used by topics, pipelines, per-agent memory.
- **`transaction`** — `batch()` + rollback on throw. Used by multi-topic publish, atomic step transitions, job claim.
- **`compaction`** — `reactiveLog` keep-latest-per-key mode. Used by topic log compaction, memory dedup, executionLog trimming.
- **`tieredStorage`** — compose two `CheckpointAdapter`s (hot → cold). Hot = memoryAdapter/sqlite. Cold = postgres/S3 via Phase 7 adapters. Used by topics, executionLog, memory, checkpoint.

### Gap Analysis vs Real Pulsar

Everything above the application semantics line — we match Pulsar. Below is distributed systems infrastructure (BookKeeper, geo-replication, multi-tenancy clustering) that we don't build. The value proposition is different: Pulsar = cross-datacenter backbone. Ours = embeddable in-process messaging (`npm install`).

Phase 7 adapters bridge to external brokers for distribution — our system owns the programming model, the broker owns the wire.

### Task Reuse Confirmation

`task` in the job queue is the **exact same `task()` from orchestrate/**. `jobQueue` doesn't invent new processing primitives — it wires `topic` → `subscription` → `task()`. Same `taskState`, same companions, same retry semantics.

---

## REJECTED ALTERNATIVES

1. **CRDTs for job queue state** — Overkill. Jobs are claimed (ownership), not merged (convergence).
2. **RabbitMQ model** — Consume-and-delete is at odds with reactive streams. Pulsar's cursor model maps directly.
3. **Distributed locks** — Prefer saga pattern (pipeline + checkpoint + onFailure). CALM theorem: monotonic ops need zero coordination.
4. **Broker-free competing consumers via Node V1** — Possible (hash chain + fork detection) but ambitious. External broker is pragmatic.
5. **reactiveIndex as priority queue** — Wrong data structure. Unordered Sets, no numeric comparison, no dequeue.
6. **Reactive priority queue** — Over-engineering. Nobody derives from queue internals. Plain heap in utils/ suffices.
7. **Messaging-specific schema/namespace/transactions** — Should be generic cross-cutting infra benefiting all layers.

---

## KEY INSIGHTS

1. **Message queue is the foundation, job queue is a wrapper.** Two birds, one stone.
2. **Pulsar's model (stream + cursor) maps 1:1 to callbag (source + subscribe with backpressure).** RabbitMQ's consume-and-delete does not.
3. **Pull-based backpressure + persistence = cursor-based consumption.** This is native to callbag.
4. **CRDTs solve convergence. Job queues need ownership.** Different problems.
5. **Schema, namespace, transaction, compaction, tieredStorage are cross-cutting.** They serve messaging, orchestration, and memory equally — belong in utils/data, not in messaging.
6. **tieredStorage composes existing `CheckpointAdapter` interface.** No new abstraction needed — just two adapters wired with a promotion policy.

---

## OUTCOME

Roadmap updated with two new phases:

**Phase 5d: Cross-Cutting Infrastructure** (6 deliverables in utils/ + data/)
- `PriorityQueue<T>`, `withSchema`, `namespace`, `transaction`, `compaction`, `tieredStorage`

**Phase 5e: Messaging — Pulsar-Inspired Topic System** (8 deliverables)
- Layer 1: `topic`, `subscription`, lifecycle, retry/DLQ, repeatable producers
- Layer 2: `jobQueue`, job events, multi-queue workflows

Distribution defers to Phase 7 adapters (Redis, NATS) — external broker handles competing consumers, the programming model stays the same.

---

## FILES CHANGED

- `docs/roadmap.md` — Added Phase 5d (cross-cutting infra) and Phase 5e (messaging/job queue)
