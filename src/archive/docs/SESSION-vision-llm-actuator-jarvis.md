---
SESSION: vision-llm-actuator-jarvis
DATE: March 26–27, 2026
TOPIC: Vision — recharge as LLM actuator layer, Jarvis-like graph builder, Graph as universal output type, primitive semantic alignment
REPO: Cross-repo session (discussed in Python port, applies to both TS and Python)
---

## KEY DISCUSSION

### The three-layer vision

**Layer 1 — Backend state unification:** Replace scattered backend concerns (session, RBAC, auth, Celery, ORM) with a unified reactive graph. Every backend concern becomes state nodes + derived computations + effects.

**Layer 2 — LLM actuator layer:** The reactive graph is the "hands" for LLMs. An LLM doesn't call imperative APIs — it writes to `state()` nodes, and effects propagate through the entire running environment:

- `budget_mode.set("economy")` → model routing, token limits, retry policies, parallelism all recompute
- `threat_level.set("high")` → auth tightens, rate limits change, logging increases, expensive ops pause
- `routing_strategy.set("local_only")` → tool calls reroute, fallbacks activate, cost projections update

Closed-loop control system: LLM observes → reasons → writes state → system reacts → LLM observes new state.

**Layer 3 — LLM as graph builder ("Jarvis"):** The library is small enough that LLMs can BUILD new reactive graphs from scratch. User says "monitor that server's load" → LLM builds graph → graph persists and is reusable. Graphs are artifacts, not ephemeral code.

### Market research (March 2026)

Extensions prioritized over congested traditional backend space:
- Multi-agent state coordination (#1 pain point per Deloitte, Salesforce)
- MCP state backend (97M downloads, zero state layer)
- Reactive observability (graph IS the trace)
- Reactive RAG freshness, LLM smart routing, dynamic workflow engine
- Agent governance/policy, cost control graph

Only direct Python competitor: **reaktiv** (v0.21.0) — lacks two-phase DIRTY/DATA, typed protocols, per-subgraph locking.

### Primitive semantic alignment audit

Audited all core primitives for lifecycle signal semantics vs LLM expectations.

**Decisions:**

| Signal/Behavior | Decision | Rationale |
|---|---|---|
| RESET → **INVALIDATE** | **Rename** | Current behavior (clear state, don't auto-emit) is correct. Push+pull symmetry would cause 2 emits after RESET. User decides when to re-emit, like TS workflow builder. Name "RESET" misleads LLMs into expecting restart semantics. |
| PAUSE/RESUME | **Keep as plumbing signals** | TS has `pausable` in extra/ that gives them concrete semantics. Port to Python. |
| `.next()` after `complete()` | **Keep as silent no-op** | Matches RxJS Subject behavior. Document it. |
| Producer cleanup timing | **Fix in both TS and Python** | Can't just cleanup on last-unsubscribe because resubscription may follow. TEARDOWN should always run cleanup (terminal). Last-unsubscribe cleanup needs delay/flag for resubscription safety. |
| `derived.get()` after TEARDOWN | **Return stale cache** | User checks `.status` to decide trust. Avoids expensive status checks in derived hot path. |
| Effect on ANY dep completion | **Change to combineLatest semantics** | Complete when ALL deps complete, not ANY. RxJS `combineLatest` completes on ALL. Current behavior is stricter than expected. Fix in both TS and Python. |

**Key principle:** When semantics diverge from names, rename the signal (don't change correct behavior). INVALIDATE is honest about what the signal does.

### Graph as universal output type (architecture v5)

**Key architectural decision:** `Graph` is the universal container. Domain builders (`pipeline`, `jobQueue`, `topic`, etc.) become factories that PRODUCE `Graph` objects.

```typescript
// Domain builder returns a Graph
const paymentFlow = pipeline("payment", {
  validate: task(validatePayment, { retry: 3 }),
  charge:   task(chargeCard, { deps: ["validate"] }),
});
// paymentFlow IS a Graph — has .describe(), .knobs(), .gauges()

// Compose via mounting
const system = new Graph("payment_system");
system.mount("flow", paymentFlow);
system.mount("email", emailQueue);
system.connect("flow.notify", "email");
```

This gives:
- **One introspection API** — `graph.describe()` works regardless of construction method
- **One lifecycle** — INVALIDATE/TEARDOWN propagates through mounted subgraphs
- **One registry** — `GraphRegistry` catalogs all graphs
- **One observability** — tracing across subgraph boundaries
- **Domain-specific DX preserved** — `pipeline()` still speaks workflow, `jobQueue()` speaks queue

**This requires architecture v5** in both TS and Python. The Graph abstraction cuts across all tiers.

### LLM composition strategy

No custom DSL. Constrained dict-based `Graph()` builder API. LLMs generate plain Python/TypeScript. The constrained API IS the "language."

Key abstractions:
- `Graph(name, nodes_dict)` — declarative construction
- `Knob(name, type, range, description)` — typed LLM-writable state
- `Gauge(name, source, description)` — typed LLM-observable state
- `knobs_as_tools()` → auto-generate MCP/OpenAI tool schemas
- `graph.describe()` → JSON schema for LLM introspection

### Open items for follow-up sessions

1. **Architecture v5 design** — Graph as universal container, interaction with tier hierarchy, mount/connect semantics
2. **Semantic alignment checklist** — systematic check of ALL primitives + operators for LLM-surprising behaviors
3. **INVALIDATE rename** — implementation in both TS and Python, migration path
4. **Effect combineLatest completion** — change to complete-on-ALL, test impact in both libs
5. **Producer cleanup timing** — resubscription-safe cleanup design, align TS and Python

## REJECTED ALTERNATIVES

- **"Replace X" positioning** — rejected framing as "replace Celery/SQLAlchemy." Better: "reactive coordination layer that sits between them."
- **Custom DSL** — rejected new syntax for graph definition. Plain Python/TypeScript with constrained API.
- **RESET with auto-emit** — push+pull symmetry would cause 2 emits. User controls when to re-emit after invalidation.
- **Graph as separate from pipeline/jobQueue** — rejected. Graph is the universal output type; domain builders are factories.
- **Cleanup only on last-unsubscribe** — can't assume no resubscription. Need TEARDOWN-triggered cleanup.
- **Effect complete-on-ANY** — doesn't match combineLatest semantics that users expect.

## KEY INSIGHTS

1. Most AI frameworks treat LLMs as consumers of state. Recharge makes LLMs **producers** of state.
2. Keeping the core small is a strategic moat — enables LLMs to generate graphs from scratch.
3. Graphs as artifacts (not ephemeral code) compound over time.
4. LLMs can't reliably compose low-level primitives — need constrained builder APIs.
5. Signal names must match behavior. When they don't, rename (RESET→INVALIDATE).
6. Graph-as-universal-output-type unifies introspection, lifecycle, observability across all domain builders.
7. Producer cleanup timing can't assume no resubscription.
8. Effect should match combineLatest (complete on ALL, not ANY).

## FILES CREATED / CHANGED

**Python repo (callbag-recharge-py):**
- `src/archive/docs/SESSION-vision-llm-actuator-jarvis.md` — this session
- `src/archive/docs/DESIGN-ARCHIVE-INDEX.md` — updated with this session
- `docs/roadmap.md` — Phase 5 (LLM surface), Phase 6 (AI extensions), Phase 7 (polish)

**TS repo (callbag-recharge):**
- `src/archive/docs/SESSION-vision-llm-actuator-jarvis.md` — mirrored session

---END SESSION---
