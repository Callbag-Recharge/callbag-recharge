---
SESSION: reflow-spec-design
DATE: March 27, 2026
TOPIC: ReFlow unified spec — protocol, single primitive, Graph container, cross-repo (TS + Python)
REPO: Cross-repo session (callbag-recharge TS + callbag-recharge-py)
---

## KEY DISCUSSION

### Strategic 7-step spec design process

Designed a unified spec for both TS and Python repos through a structured process:

0. **Lessons learned** — audited 170+ TS modules and Python Phase 0-1 implementation for what worked, what failed, what diverged
1. **Demands & gaps** — 7 demands (human+LLM co-operation, persistent graphs, inspectability, graphs-as-solutions, modularity, real-time, language-agnostic), 12 gaps identified
2. **Functionalities** — 10 concrete capabilities mapped to demands
3. **Common patterns** — 8 cross-cutting patterns extracted (source→transform→sink, companion metadata, builder→graph, two-phase transition, boundary bridge, introspection, lifecycle propagation, scope isolation)
4. **Basic primitives** — progressively simplified from 6 nodes → 5 → 1
5. **Nice-to-haves** — versioning, subgraph ops, LLM surface, observability, distribution
6. **Scenario validation** — 7 real-world scenarios stress-tested against the spec

### Radical simplification decisions

#### 1. Unified message protocol (no callbag types)
Callbag's 4-type system (START=0, DATA=1, END=2, STATE=3) replaced with:
- **One format:** always `[[Type, Data?], ...]` — array of tuples, no single-message form
- **9 message types:** DATA, DIRTY, RESOLVED, INVALIDATE, PAUSE, RESUME, TEARDOWN, COMPLETE, ERROR
- No channel separation (DATA vs CONTROL) — just typed messages in one stream
- Batching is inherent in the array format

**Rationale:** With typed interfaces (not function signatures), integer type tags are unnecessary. Unified format eliminates conditional checking. Always-array eliminates single-vs-batch branching.

#### 2. One primitive: `node`
5 primitives (state, derived, producer, operator, effect) collapsed into one:

```
node(deps?, fn?, opts?)
```

Behavior determined by configuration:
- No deps, no fn → manual source (state)
- No deps, with fn → auto source (producer)
- Deps, fn returns value → reactive compute (derived)
- Deps, fn uses down() → full protocol (operator)
- Deps, fn returns nothing → side effect (effect)

Sugar constructors (`state()`, `derived()`, `effect()`, etc.) exist for readability.

**Rationale:** dynamicDerived merged into derived (Python taught us: declare superset at construction, runtime tracking is optimization). Then state is sugar for producer. Then derived/operator/effect are all "node with deps and fn" with different fn behaviors. One primitive, many behaviors.

#### 3. Unified node interface
Every node:
```
node.get()          — cached value (never errors, even disconnected)
node.status         — trust level indicator
node.down(msgs)     — send downstream
node.up(msgs)       — send upstream
node.unsubscribe()  — disconnect from deps
node.meta           — companion stores (each key subscribable)
```

#### 4. Meta as companion stores
`{ meta: { status: "idle", error: null } }` — each key becomes a subscribable node. Replaces all `with*()` wrapper patterns. Reactive metadata without separate wrapper types.

#### 5. No separate Knob/Gauge types
Knobs = writable nodes with meta. Gauges = readable nodes with meta. `describe()` exposes both. No new types — just metadata on existing nodes.

#### 6. No separate Inspector
`Graph.observe()` and `Graph.describe()` replace Inspector entirely. The Graph IS the introspection layer.

#### 7. Colon-delimited namespacing
`"system:payment:validate"` — no separate namespace primitive. Mount prepends parent scope.

#### 8. No transforms on edges
Edges are pure wires (`{ from, to }`). Need a transform? Add a node. This keeps edges serializable and graph topology fully visible.

#### 9. get() never errors
Returns cached value always. `status` tells you trust level. No mandatory pull-recompute.

### Vision: ReFlow as new library

Decision to create new repos (reflow-ts, reflow-py) rather than evolve callbag-recharge. Reasons:
- Almost a complete rewrite (unified protocol, single primitive, Graph container)
- Name change needed regardless
- Clean break from callbag spec dependency
- Both repos start fresh with v5 architecture

Working name: "ReFlow" — re = reactive, review, reusable. Final name TBD.

npm conflicts found: `reflow` (0.0.8, workflow helper), `reflow-ts` (0.2.0, durable workflow). `@reflow/core` scope available. PyPI `reflow` is placeholder (0.0.1), `reflow-py` appears free.

## REJECTED ALTERNATIVES

- **Keep callbag 4-type system** — unnecessary complexity with typed interfaces. Unified message format is simpler.
- **Separate DATA and CONTROL channels** — no reason for separation when everything is typed tuples.
- **5 separate primitives** — all variations of one concept: "node with optional deps and optional fn."
- **Separate Knob/Gauge types** — just metadata on state/derived. No new abstractions.
- **dynamicDerived as separate primitive** — Python lesson: declare superset at construction. Runtime tracking is optimization, not spec.
- **get() pull-recomputes when disconnected** — over-complex. Return cached, let status tell truth.
- **Transforms on edges** — violates "everything is a node." Edges are pure wires.
- **Separate Inspector tool** — Graph.observe() and Graph.describe() cover all use cases.
- **Single-message format option** — always array-of-arrays eliminates branching.

## KEY INSIGHTS

1. The 5 callbag-recharge primitives were implementation categories, not conceptual ones. A node is a node.
2. Meta-as-companion-stores unifies all `with*()` patterns into one concept.
3. Always-array message format (`[[Type, Data?], ...]`) eliminates all single-vs-batch branching.
4. Dropping callbag's integer types for a typed message protocol is strictly better with modern type systems.
5. `get()` should never error — it's a cache read. `status` is the truth.
6. 7 scenarios validated: LLM cost control, security policy, human-in-the-loop, Excel calculations, multi-agent routing, LLM graph building, git versioning.
7. The spec fits in ~350 lines. An LLM needs ~8 concepts to build anything.

## FILES CREATED / CHANGED

**TS repo (callbag-recharge):**
- `REFLOW-SPEC.md` — the unified spec (v0.1.0 draft)
- `src/archive/docs/SESSION-reflow-spec-design.md` — this session

**Python repo (callbag-recharge-py):**
- `REFLOW-SPEC.md` — mirrored spec

---END SESSION---
