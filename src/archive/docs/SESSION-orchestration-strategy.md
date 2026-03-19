# Orchestration Strategy: Reactive Workflow Engine

> **Status:** Strategic plan. Based on research of user pain points across n8n, Airflow, Jenkins,
> Dify, Coze, LangGraph, CrewAI, Temporal, Inngest, and emerging AI agent orchestration patterns
> (March 2026).

---

## 0. The Thesis

**Orchestration tools are stuck in the promise/callback era.** Airflow uses Python functions.
n8n uses HTTP request-response per node. Jenkins uses Groovy scripts. Even "modern" tools like
LangGraph use state dicts with imperative transitions. None of them treat data flow as a
first-class reactive stream.

callbag-recharge already has the primitives to replace all of this:
- `derived([fetchBank, fetchCards], merge)` IS diamond resolution — no DAG executor needed
- `pipe(source, exhaustMap(work), retry(3))` IS a resilient task — no `workflowTask` config needed
- `effect([trigger], run)` IS a reactive trigger — no cron scheduler framework needed

**The gap is not in primitives.** The gap is in **pre-composed pipes** that make common
orchestration patterns one-liners, and in **new primitives** for patterns that don't exist yet
(gates, durable steps, dynamic routing).

---

## 1. Research: What Users Actually Hate (March 2026)

### 1.1 The Universal Pain Points

| Pain | Who suffers | Root cause |
|------|-------------|------------|
| **Debugging is impossible** | n8n (UI-only), Airflow (operator inspection), LangGraph (non-deterministic) | No reactive observability — polling, not pushing |
| **Fragility at scale** | n8n (lost 147 leads from one API change), Jenkins (plugin cascading failures) | No circuit breakers, no reactive error propagation |
| **Hidden operational costs** | n8n (15+ hrs/month maintenance), Airflow (migration hell) | Monolithic — can't swap parts without rewriting |
| **Stateless between runs** | n8n AI agents (no persistent memory), Dify (no cross-session context) | No durable state primitive |
| **Static DAGs** | Airflow (deploy-time only), all traditional tools | No dynamic routing, no cycles, no runtime graph modification |
| **No human-in-the-loop** | All tools bolt this on as afterthought | No native "pause stream and wait" primitive |

### 1.2 What Changed in the AI Era

**Traditional orchestration (ETL/CI-CD):**
- Static DAG, deterministic steps, minutes-long runs, batch, server-only

**AI-era orchestration:**
- Dynamic/cyclic graphs, non-deterministic steps, runs lasting days/weeks,
  event-driven, edge/browser/serverless, human-in-the-loop, cost-aware (tokens),
  reasoning traces not just logs

**The fundamental shift:** AI has commoditized code generation, making **coordination the
scarce resource.** When Claude/GPT can generate any individual step, the value is entirely
in orchestrating those steps — sequencing, error handling, state management, data flow.

### 1.3 Emerging Patterns That Matter

1. **Event-driven over batch** — Millisecond-latency triggers, not cron. We already do this.
2. **Durable execution** — Each step is a checkpoint. Completed steps skip on retry (Temporal/Inngest model).
3. **Dynamic graphs** — Cycles, conditional edges, nodes that spawn nodes. LangGraph explicitly supports cycles because DAGs are wrong for agentic work.
4. **Human-in-the-loop as first-class** — Pause stream, wait for approval, resume. Not a webhook hack.
5. **Composable pipes over monoliths** — Teams use 3-4 tools composed together, creating "orchestrate the orchestrators" pain. A pipe model avoids this entirely.
6. **Edge/browser execution** — Growing from $21.4B to $28.5B (2025→2026). Lightweight, embeddable orchestration that works client-side is underserved. This is our unique positioning.
7. **MCP as universal integration** — Model Context Protocol is the de facto standard for AI tool integration. A reactive adapter would be powerful.

---

## 2. The Gap: Original Vision vs. Actual Demo

The Level 3 strategic plan had the right vision:

```ts
// The INTENDED design (SESSION-level3-strategic-plan.md, lines 113-118)
const daily = fromCron('0 9 * * *');
const fetchBank = pipe(daily, exhaustMap(() => fromPromise(plaid.sync())), retry(3));
const fetchCards = pipe(daily, exhaustMap(() => fromPromise(stripe.charges())), retry(3));
const aggregate = derived([fetchBank, fetchCards], (bank, cards) => merge(bank, cards));
const alerts = pipe(aggregate, filter(txns => txns.some(t => t.amount > 500)));
effect([alerts], txns => telegram.send(format(txns)));
```

But the actual airflow demo fell back to imperative code:

```ts
// What ACTUALLY shipped (pipeline.ts, lines 121-167)
async function trigger() {
  await cron.task.run(() => simulateWork(...));
  const [bankResult, cardsResult] = await Promise.allSettled([...]);
  if (bankOk || cardsOk) {
    await runNode(aggregate, ...);
    if (aggregate.task.get().status === 'success') {
      await Promise.allSettled([...]);
    }
  }
}
```

**Why the gap?** Because the primitives exist but the wiring is manual:
- No way to say "run this work when upstream emits, track status, apply breaker"
- No way to say "wait for human approval before continuing"
- No way to pass output of node A as input to node B through the reactive graph
- `taskState` is imperative (`task.run(fn)`) instead of reactive (connect to upstream)

---

## 3. Design Philosophy

### 3.1 Everything is a pipe, not a config

**Wrong (old-world, config-object pattern):**
```ts
workflowTask({ id: 'fetch', fn: plaid.sync, retries: 3, timeout: 30000, breaker: { threshold: 5 } })
```

**Right (our philosophy — compose operators):**
```ts
pipe(trigger, exhaustMap(() => fromPromise(plaid.sync())), retry(3), timeout(30000), withBreaker(5))
```

Each concern is an independent operator. Users compose what they need. No god-object configuration.

### 3.2 Data flows through, not around

Every node's output is the next node's input — through the callbag protocol. No XCom, no
shared state dict, no manual result threading. `derived([a, b], (aVal, bVal) => ...)` already
does this. The orchestration layer just needs to make task results flow as store values.

### 3.3 The graph is alive, not frozen

Traditional DAGs are defined at deploy time. Our reactive graph is inherently dynamic:
- `effect()` can create new `state()` nodes at runtime
- `switchMap` swaps inner subscriptions dynamically
- Conditional `derived()` chains can route data based on content
- `gate()` pauses and resumes flow based on external signals

### 3.4 Kill promises, use streams

Every async operation should be expressible as a producer/operator chain:
- `fromPromise(fn)` → one-shot async
- `fromAsyncIter(iter)` → streaming async
- `exhaustMap(() => fromPromise(work))` → "run when triggered, ignore re-triggers while running"
- `switchMap(() => fromPromise(work))` → "run when triggered, cancel previous"
- `concatMap(() => fromPromise(work))` → "queue and run sequentially"

The user never writes `async/await`. The reactive graph handles sequencing, cancellation,
error propagation, and retry.

---

## 4. What to Build

### Level 3E: Orchestration Primitives (New)

#### 4.1 `gate()` — Human-in-the-Loop Primitive

The most requested missing pattern. A gate pauses the reactive stream until an external
signal (human approval, AI decision, webhook, timer) allows it to continue.

```ts
// gate() is a producer that holds upstream values until opened
const approval = gate<AggregateResult>();

// Wire into pipeline
const pipeline = derived([aggregate], (data) => data);
effect([pipeline], (data) => approval.submit(data));  // submit to gate

// Gate blocks until approved
const approved = pipe(approval, map(data => data));

// External trigger (UI button, API call, AI agent)
approval.approve();           // release held value downstream
approval.reject('reason');    // reject and propagate error
approval.approve(modified);   // release with modifications (ad-hoc changes!)

// Reactive status
approval.status;              // Store<'waiting' | 'approved' | 'rejected' | 'idle'>
approval.pending;             // Store<T | undefined> — the value waiting for approval
```

**Why this matters:**
- Every AI workflow needs human checkpoints
- The ad-hoc modification on approve (`approve(modified)`) solves the "can't change the
  graph after a checkpoint" pain the user identified
- Status is reactive — UI can show "waiting for approval" without polling
- Composes naturally: `pipe(source, gate(), map(transform), sink)`

#### 4.2 `track()` — Reactive Task Tracking Operator

Instead of imperative `taskState.run(fn)`, a reactive operator that wraps any async
operation with status tracking, duration, run count — automatically.

```ts
// track() wraps an operator and adds observable metadata
const fetchBank = pipe(
  trigger,
  track(exhaustMap(() => fromPromise(plaid.sync())), { id: 'fetch-bank' }),
  retry(3),
);

// Metadata is reactive
fetchBank.meta;        // Store<{ status, duration, runCount, error, lastRun }>
fetchBank.meta.get();  // { status: 'success', duration: 342, runCount: 5, ... }
```

**Key difference from `taskState`:** It's an operator in a pipe, not a standalone object.
Data flows through it. The tracking is a side-effect of the data flowing, not a manual
`.run()` call.

#### 4.3 `withBreaker()` — Circuit Breaker Operator

Wraps the existing `circuitBreaker` utility as a pipe operator.

```ts
const resilientFetch = pipe(
  trigger,
  withBreaker({ threshold: 3, cooldown: exponential({ base: 1000 }) }),
  exhaustMap(() => fromPromise(plaid.sync())),
);

// Reactive circuit state
resilientFetch.breaker;  // { state: Store<CircuitState>, failureCount: Store<number> }
```

When the breaker opens, upstream emissions are blocked (not forwarded). When it transitions
to half-open, it allows one trial. On success, it closes. This is pure stream semantics —
no manual `if (breaker.canExecute())` checks.

#### 4.4 `withRetry()` — Retry with Backoff Operator

Composes `retry()` + backoff strategy as a single operator with observable retry state.

```ts
const resilient = pipe(
  trigger,
  withRetry(3, exponential({ base: 1000 })),
  exhaustMap(() => fromPromise(work)),
);

resilient.retries;  // Store<{ attempt: number, nextIn: number | null }>
```

#### 4.5 `route()` — Dynamic Conditional Routing

Routes data to different downstream paths based on content. Unlike static DAG edges,
routing decisions are made at runtime based on the actual data.

```ts
const [anomalies, normal] = route(
  aggregate,
  (data) => data.hasAnomaly,  // predicate
);

// anomalies and normal are both Store<T> — pipe further
effect([anomalies], (data) => telegram.send(formatAlert(data)));
effect([normal], (data) => db.batchWrite(data));
```

**Why not just `filter()`?** `route()` gives you both branches. `filter()` discards the
non-matching values. For workflows, you usually want to handle both paths.

#### 4.6 `checkpoint()` — Durable Step Boundary

Marks a point in the pipe where the value should be persisted. On recovery, the pipeline
resumes from the last checkpoint rather than re-running completed steps.

```ts
const pipeline = pipe(
  trigger,
  exhaustMap(() => fromPromise(fetchData())),
  checkpoint('after-fetch', adapter),         // persist result here
  map(transformData),
  checkpoint('after-transform', adapter),     // and here
  exhaustMap(() => fromPromise(writeData())),
);

// adapter is pluggable: localStorage, IndexedDB, SQLite, S3
const adapter = localStorageCheckpoint('pipeline-v1');
```

**How it works:** `checkpoint` is an operator that:
1. On emit: persists value + checkpoint ID to adapter, then forwards
2. On recovery: checks adapter for saved value at this checkpoint ID. If found, emits
   saved value immediately (skipping upstream). If not, passes through normally.

This gives Temporal-style durable execution without a server.

### Level 3E: Higher-Level Compositions

#### 4.7 `pipeline()` — Declarative Workflow Builder

The "bigger lego" that replaces the manual airflow demo. Not a new primitive — composed
from existing operators.

```ts
const workflow = pipeline({
  id: 'finance-pipeline',
  trigger: fromCron('0 9 * * *'),           // or fromWebhook(), manual(), etc.
  steps: {
    fetchBank:  (trigger) => pipe(trigger, exhaustMap(() => fromPromise(plaid.sync())), retry(3)),
    fetchCards: (trigger) => pipe(trigger, exhaustMap(() => fromPromise(stripe.charges())), retry(3)),
    aggregate:  (fetchBank, fetchCards) => derived([fetchBank, fetchCards], merge),
    review:     (aggregate) => pipe(aggregate, gate()),    // human approval!
    detect:     (review) => pipe(review, map(detectAnomalies)),
    alert:      (detect) => pipe(detect, filter(hasAnomaly), exhaustMap(() => fromPromise(notify()))),
    write:      (review) => pipe(review, exhaustMap(() => fromPromise(batchWrite()))),
  },
});

// Everything is reactive
workflow.steps.fetchBank;           // Store<BankData>
workflow.steps.fetchBank.meta;      // Store<TaskMeta> (if track() is used)
workflow.steps.review.gate;         // gate controls (approve/reject)

// Trigger manually
workflow.trigger();

// Observe the entire pipeline
workflow.status;    // Store<Map<string, StepStatus>>
workflow.log;       // ReactiveLog of all step events

// Ad-hoc modification mid-run
workflow.steps.review.gate.approve(modifiedData);  // change data at checkpoint!

// Destroy
workflow.destroy();
```

**How `steps` wiring works:**
- Each step is a function whose **parameter names** match other step IDs (or 'trigger')
- The builder resolves dependencies from parameter names (like Angular DI / pytest fixtures)
- Automatically validates acyclicity (Kahn's algorithm via existing `dag()`)
- Steps with multiple deps use `derived()` for diamond resolution
- Steps with no downstream subscribers are not connected (lazy)

**Alternative: explicit deps (simpler, no magic):**

```ts
const workflow = pipeline({
  trigger: fromCron('0 9 * * *'),
  steps: [
    step('fetchBank',  [TRIGGER],                 (t) => pipe(t, exhaustMap(plaid.sync), retry(3))),
    step('fetchCards',  [TRIGGER],                 (t) => pipe(t, exhaustMap(stripe.list), retry(3))),
    step('aggregate',   ['fetchBank','fetchCards'], ([bank, cards]) => merge(bank, cards)),
    step('review',      ['aggregate'],             (agg) => pipe(agg, gate())),
    step('alert',       ['review'],                (data) => pipe(data, filter(hasAnomaly), ...)),
    step('write',       ['review'],                (data) => pipe(data, exhaustMap(batchWrite))),
  ],
});
```

#### 4.8 `fromWebhook()` / `fromTrigger()` — Event Sources

```ts
// HTTP webhook (Node.js / edge)
const webhook = fromWebhook({ path: '/trigger', method: 'POST' });

// Manual trigger (UI button, API call)
const manual = fromTrigger<Params>();
manual.fire({ userId: '123' });  // emit into the stream

// Composition
const trigger = merge(fromCron('0 9 * * *'), webhook, manual);
```

#### 4.9 `withTimeout()` — Timeout as Operator

```ts
const bounded = pipe(
  trigger,
  withTimeout(30_000),  // cancel + error if step takes > 30s
  exhaustMap(() => fromPromise(slowWork())),
);
```

---

## 5. How This Compares

### 5.1 vs. Airflow

| Concern | Airflow | callbag-recharge |
|---------|---------|-----------------|
| DAG definition | Python decorator + deps | `derived([deps], fn)` or `pipeline({ steps })` |
| Execution | Celery workers, scheduler | In-process reactive graph |
| Data passing | XCom (serialized, size-limited) | Direct value flow through callbag protocol |
| Retry | `retries=3` per operator | `retry(3)` or `withRetry(3, backoff)` in pipe |
| Human approval | External sensor polling | `gate()` — native pause/resume |
| Dynamic routing | BranchPythonOperator | `route()` or conditional `derived()` |
| Monitoring | Web UI polling Postgres | `Inspector` — push-based, zero-overhead |
| Deployment | Python + Celery + Redis + Postgres | Single JS import, runs anywhere |

### 5.2 vs. n8n

| Concern | n8n | callbag-recharge |
|---------|-----|-----------------|
| Workflow definition | Visual UI (JSON under the hood) | Code-first pipes (UI can be layered on top) |
| Execution | Per-step HTTP, stateless | Reactive stream, stateful |
| Error handling | Manual retry config per node | Composable: `retry()`, `withBreaker()`, `rescue()` |
| AI agents | Stateless between executions | Reactive memory (Level 3 data structures) |
| Scale | Server crashes at 100k rows | In-process, bounded by runtime memory |
| Cost | Per-execution pricing | Zero runtime cost (it's a library) |
| Debugging | "Very hard since it's all UI" | `Inspector.snapshot()`, `trace()`, `spy()` |

### 5.3 vs. Temporal

| Concern | Temporal | callbag-recharge |
|---------|----------|-----------------|
| Durable execution | Server-side replay | `checkpoint()` + pluggable adapter |
| Learning curve | ~1 month to productivity | Same primitives as state management |
| Deployment | Temporal server + workers | Library import |
| Bundle size | Server infrastructure | Tree-shakeable, sub-10 KB for orchestration |
| Browser/edge | No | Yes |

### 5.4 vs. LangGraph

| Concern | LangGraph | callbag-recharge |
|---------|-----------|-----------------|
| Graph model | State dict + transitions | Reactive stores + callbag protocol |
| Cycles | Explicit cycle support | Natural — `effect()` → `set()` → `derived()` |
| State | Mutable dict with reducers | Immutable stores with two-phase push |
| Human-in-the-loop | `interrupt()` + resume | `gate()` — native stream pause |
| Observability | External tracing required | Built-in `Inspector` |
| Standalone GUI | None | None (same — both code-first) |

---

## 6. Build Order

### Phase 1: Core Orchestration Operators (Priority: P0)

| # | What | Why first | Effort |
|---|------|-----------|--------|
| 1 | `gate()` | Solves the #1 user pain (human-in-the-loop). Novel — no other lightweight library has this. | 1-2 days |
| 2 | `track()` | Makes `taskState` pipe-native. Unlocks reactive task metadata in any pipe. | 1 day |
| 3 | `route()` | Dynamic conditional branching. Replaces `if/else` on status checks. | 0.5 day |
| 4 | `withBreaker()` | Wraps existing circuitBreaker as operator. Trivial. | 0.5 day |
| 5 | `withRetry()` | Composes existing retry + backoff. Observable retry state. | 0.5 day |
| 6 | `withTimeout()` | Composes existing timeout. Operator form. | 0.5 day |
| 7 | `fromTrigger()` | Manual trigger source. Essential for non-cron workflows. | 0.5 day |

**Deliverable:** Rewrite the airflow demo using pure pipes — zero `async/await`.

### Phase 2: Higher-Level Compositions (Priority: P1)

| # | What | Why | Effort |
|---|------|-----|--------|
| 8 | `pipeline()` builder | The "bigger lego" — declarative workflow definition | 2-3 days |
| 9 | `checkpoint()` | Durable execution — skip completed steps on retry/recovery | 2 days |
| 10 | `fromWebhook()` | HTTP trigger source (Node.js) | 1 day |

**Deliverable:** A pipeline demo that shows: cron trigger → parallel fetch → gate (human
approval with ad-hoc modification) → conditional routing → alert + write. All reactive,
all observable, all in ~20 lines.

### Phase 3: AI Agent Orchestration (Priority: P1)

| # | What | Why | Effort |
|---|------|-----|--------|
| 11 | MCP adapter (`fromMCP`) | Connect to AI tool ecosystem via Model Context Protocol | 2-3 days |
| 12 | Reasoning trace in Inspector | Capture *why* a path was taken, not just *what* happened | 1-2 days |
| 13 | Token/cost tracking operator | AI-era concern: track token consumption per step | 1 day |
| 14 | Agent memory integration | Wire Level 3 memory primitives into orchestration pipeline | 1-2 days |

### Phase 4: Ecosystem & Polish (Priority: P2)

| # | What | Why | Effort |
|---|------|-----|--------|
| 15 | Visual graph renderer | DAG visualization component (works with VueFlow, React Flow) | 2-3 days |
| 16 | Persistence adapters | localStorage, IndexedDB, SQLite for `checkpoint()` | 2 days |
| 17 | More trigger sources | File watcher, message queue, SSE listener | 2 days |
| 18 | Recipes & docs | "Build an n8n alternative in 50 lines" tutorial | 2-3 days |

---

## 7. The Rewritten Airflow Demo (Target)

This is what the airflow demo should look like after Phase 1+2:

```ts
import { pipe, derived, effect } from 'callbag-recharge'
import { exhaustMap, retry, filter, merge } from 'callbag-recharge/extra'
import { fromCron } from 'callbag-recharge/orchestrate'
import { gate, track, route, withBreaker, pipeline } from 'callbag-recharge/orchestrate'

const workflow = pipeline({
  id: 'finance',
  trigger: fromCron('0 9 * * *'),
  steps: [
    // Parallel fetches — diamond source
    step('fetchBank',  [TRIGGER], (t) =>
      pipe(t, withBreaker(3), track(exhaustMap(() => fromPromise(plaid.sync()))), retry(3))),

    step('fetchCards', [TRIGGER], (t) =>
      pipe(t, withBreaker(3), track(exhaustMap(() => fromPromise(stripe.charges()))), retry(3))),

    // Diamond resolution — waits for both automatically
    step('aggregate', ['fetchBank', 'fetchCards'], ([bank, cards]) =>
      mergeFinanceData(bank, cards)),

    // Human-in-the-loop — pause for review, allow ad-hoc edits
    step('review', ['aggregate'], (data) => pipe(data, gate())),

    // Dynamic routing — anomalies go one way, normal data another
    step('detect', ['review'], (data) => detectAnomalies(data)),

    step('alert', ['detect'], (data) =>
      pipe(data, filter(d => d.hasAnomaly), exhaustMap(() => fromPromise(telegram.send(...))))),

    step('write', ['review'], (data) =>
      pipe(data, exhaustMap(() => fromPromise(db.batchWrite(...))))),
  ],
});

// Observe everything reactively
effect([workflow.status], (status) => console.log('Pipeline:', status));
subscribe(workflow.log.latest, (entry) => ui.appendLog(entry));

// Human approves with modifications
workflow.steps.review.gate.approve(editedData);
```

**Compare to the 50+ lines of imperative async/await in the current demo.**

---

## 8. Unique Positioning

What no other tool can claim:

1. **Reactive orchestration** — Data flows through pipes. No promises, no async/await, no
   imperative sequencing. Diamond resolution is automatic. Error propagation follows the
   stream.

2. **Human-in-the-loop as a stream primitive** — `gate()` pauses the reactive stream and
   resumes with optional modifications. Not a webhook hack. Not polling. A first-class
   part of the pipe.

3. **Runs anywhere** — Browser, Node.js, edge, serverless. No server infrastructure.
   Tree-shakeable — import only what you use. Sub-10 KB for a full orchestration pipeline.

4. **Same primitives for state and orchestration** — `state()`, `derived()`, `effect()` are
   the same whether you're building a counter or a 50-node workflow. No new mental model.
   If you know the library, you know orchestration.

5. **Observable by default** — Every step's status, duration, retry count, circuit breaker
   state is a reactive store. No separate monitoring system. The UI subscribes directly
   to the pipeline's internal state.

6. **AI-native** — Token tracking, reasoning traces, MCP integration, reactive memory,
   and non-deterministic routing are first-class concerns, not afterthoughts.

---

## 9. Success Criteria

### The Demo Test
Can we rewrite the airflow demo with:
- Zero `async/await`
- Zero `Promise.allSettled`
- Zero manual `if (status === 'success')` checks
- Data flowing from node to node through the reactive graph
- A `gate()` where a human can pause, inspect, modify, and resume
- Full observability via `Inspector` without any extra wiring

### The "n8n in 50 Lines" Test
Can a developer build a functional workflow automation (trigger → transform → gate →
conditional routing → multiple sinks) in ~50 lines of code, with full error handling,
retry, circuit breaking, and observability?

### The AI Agent Test
Can an AI coding tool (Claude, Cursor, Copilot) generate a correct orchestration pipeline
from a natural language description, using only the primitives documented in `llms.txt`?

---

## Appendix A: Research Sources

Pain points researched across: n8n (Cybernews, Voiceflow, Latenode Community, n8n Community,
AIQ Labs), Airflow (IBM, Danube Data Labs, Airflow Summit/Wix), Jenkins (Northflank, Qovery,
Medium), Temporal (ZenML, SparkCo, Procycons), LangGraph (Latenode Community, DEV Community,
Towards Data Science), CrewAI (Towards Data Science, DEV Community), Dify (GPTBots, Skywork),
Coze (AIBase), Inngest (official docs), Kestra (2026 trends blog), general AI agent
orchestration (OneReach, Vellum, arXiv, Algomox, GoCodeo, PracData), MCP roadmap
(modelcontextprotocol.io, The New Stack).

## Appendix B: Key Research Insights

1. **"AI has commoditized code generation, making coordination the new bottleneck."** (Kestra 2026)
2. **n8n: One agency lost 147 leads ($8K) from a single API change.** No alerts, no rollback.
   Another spent 780 hours/year on workflow fixes.
3. **n8n AI agents: Stateless between executions.** Disconnecting memory reduces hallucinations by 50%.
4. **Temporal: "Expect a month before your team is productive."** Learning curve is the #1 complaint.
5. **LangGraph: "Large-scale autonomous agents and high parallelism aren't its strengths."**
6. **CrewAI: Manager-worker architecture doesn't function as documented.** Tasks execute sequentially.
7. **Edge computing market: $21.4B → $28.5B (2025→2026).** Browser/edge orchestration is underserved.
8. **MCP: De facto standard for AI tool integration.** But production gaps: stateful sessions,
   horizontal scaling, no retry semantics.
9. **No existing orchestration tool is lightweight enough to run in the browser** with full
   workflow capabilities. This is the gap.
