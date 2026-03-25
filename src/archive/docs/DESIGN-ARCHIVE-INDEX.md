# Design Decision Archive

This directory preserves detailed design discussions from key Claude Code sessions. These are not casual notes — they capture the reasoning chains, rejected alternatives, and "aha moments" that shaped the architecture.

## Core Design Sessions

### Session 8452282f (March 14) — Type 3 Control Channel Breakthrough
**Topic:** Separating state signals from data via callbag type 3

The pivotal brainstorm that shifted from v2 (dual-channel: DIRTY push + value pull) to v3 (two-phase push on type 3). 

**Key insight:** Recognize that callbag's 4-type system was designed exactly for this use case. Type 3 as a dedicated control channel allows type 1 (DATA) to carry only real values.

**Rejected:** Mixing DIRTY and DATA on type 1; pull-phase memoization; lazy derived connections.

**Downstream impact:** Producer options (initial, equals, resetOnTeardown), STANDALONE derived, RESOLVED signal.

### Session ce974b95 (March 14) — Push-Phase Memoization Debate
**Topic:** Why RESOLVED signals beat pull-phase comparison

The discussion of how to handle the `equals` option on derived stores when values are unchanged. Two approaches debated:
- **Pull-phase (v2):** Compute, then compare, then maybe propagate
- **Push-phase (v3):** Compute, decide during compute (emit RESOLVED if equal), inform downstream

**Key insight:** RESOLVED is a semantic signal, not a side effect. It cascades — if B sends RESOLVED, then C can skip recompute without re-evaluating B.

**Rejected:** Always-memoize without opt-in; pull-phase comparison; memoization at sink level.

**Downstream impact:** RESOLVED symbol, RESOLVED propagation through multi-dep nodes, transitive subtree skipping.

### Session 47f1a07f (March 15) — Library Comparison Research
**Topic:** Zustand, Jotai, SolidJS, Preact Signals — mental models and design trade-offs

Comparative research on state management libraries to understand positioning.

**Key insight:** Explicit deps are better than implicit tracking (Jotai model). Unifies callbag transport (vs SolidJS's separate notification system). Adds observability (rare in the field, borrowed from RxJS DevTools).

**Rejected:** Copy implicit tracking (Jotai), copy separate notification system (SolidJS), no Inspector.

**Outcome:** docs/state-management.md, future compat layers (jotai, zustand, signals).

### Session 4f72f2b0 (March 15) — No-Default-Dedup Decision
**Topic:** Why extras should not dedup by default (follow RxJS/callbag semantics)

Identified a correctness bug: `subscribe()` and tier 2 operators were wrongly deduplicating emissions. Fixed by removing dedup from extras.

**Key insight:** Transparency is foundational. State's `equals` handles dedup at the source. Subscribers are pure sinks — they deliver every emission. If you want dedup, use `distinctUntilChanged()`.

**Rejected:** Keep dedup for "convenience"; make it opt-out; inherit state's equals.

**Downstream impact:** 407 tests passing; fixed 8 operator instances; clarity on state vs stream semantics.

### Session ecc3a7e6 (March 15) — Benchmark Regression Exposed 3 Bugs
**Topic:** Performance regression investigation uncovered design contract violations

Re-ran benchmarks post-test-plan, found 5–8% slowdown. Investigation revealed three separate bugs:
1. `operator.complete()` / `error()` skipped `resetOnTeardown` handling
2. `producer._checkAndEmit()` didn't respect `autoDirty: false`
3. `operator` didn't forward unknown type 3 signals

**Key insight:** Benchmarks are design validation tools. Regression = contract violation (not missed optimization).

**Rejected:** Accept regression; patch symptom; simplify design to avoid options.

**Outcome:** All bugs fixed; regression eliminated; discovered edge cases through systematic testing.

### Session 8693d636 (March 16) — V4 Output Slot Optimization
**Topic:** How null→fn→Set lazy allocation saves ~90% memory for typical graphs

Implemented the output slot model replacing `_sinks: Set` with `_output: null | fn | Set`.

**Key insight:** 80% of nodes have 0–1 subscriber. Set allocation is wasteful. Lazy union type saves ~200 bytes per node while maintaining composability.

**Rejected:** Always use Set; use array for SINGLE; separate `_singleSink` / `_multiSinks`.

**Outcome:** ~90% memory savings for typical graphs; simplified unsubscribe logic; removed need for ADOPT protocol.

### Session 2d2c2674 (March 16) — ADOPT Protocol Removal
**Topic:** Why the ADOPT handshake protocol for derived node handoff isn't needed

Recognized that output slot model (mechanical null→fn→Set) makes ADOPT unnecessary.

**Key insight:** Separate two concerns: (1) dep connections via closures (always active), (2) output dispatch via output slot (mechanical). No protocol needed for output slot transitions.

**Rejected:** Keep ADOPT for "future extensibility"; rename to be clearer; make optional.

**Outcome:** Cleaner design; removed REQUEST_ADOPT/GRANT_ADOPT from protocol.ts; deleted complex state machine from derived.ts.

### Session 88e9bd81 (March 16) — V4 Benchmarks and "Cost of Correctness"
**Topic:** Performance story — Recharge wins on read, competitive on computed/diamonds

Comprehensive benchmark suite comparing Recharge to Preact Signals, SolidJS, RxJS.

**Key results:**
- State read: 177M ops/sec (1.5x faster than Preact)
- State write: 36.5M ops/sec (1.1x)
- Computed: 18.9M ops/sec (1.3x)
- Diamond: 25.3M ops/sec (1.2x)

**Key insight:** "Cost of correctness" narrative: memory overhead (~6x vs Preact) buys observability, correct diamond resolution, push-phase memoization, and explicit deps.

**Rejected:** Lazy STANDALONE (breaks `.get()`); remove Inspector; copy Preact's cached flag.

**Outcome:** docs/benchmarks.md, docs/optimizations.md, performance regression guards in test suite.

### Session unified-state-management (March 16) — Unified State Management Across Frontend & Backend
**Topic:** Why frontend state management and backend event processing are the same problem, and how callbag-recharge + Inspector unifies them

The strategic discussion identifying that the frontend/backend divide in state management is artificial — caused by tools being afraid of different things (frontend fears streaming, backend fears fine-grained reactivity). callbag-recharge bridges both because callbag protocol doesn't distinguish timescales.

**Key insight:** Inspector is the unifying principle. The reason these worlds feel opaque is lack of runtime graph visibility. AI memory (3-layer model: working, session, long-term) is the P0 application because it naturally spans all timescales.

**Rejected:** Wrap Redis/Kafka as connectors only; ship separate frontend/backend packages; use Inspector as Jotai compat registry; add implicit tracking to core.

**Outcome:** `memoryStore` pattern (P0), `createStore()` pattern (P1), compat layer strategy (Jotai registry-based, Zustand StoreApi match), backend positioning strategy.

### Session createStore-pattern (March 17) — createStore Pattern Implementation
**Topic:** Zustand-style single-store pattern backed by callbag-recharge, protocol-level teardown(), adversarial code review

Implemented the `createStore()` pattern matching Zustand's `create((set, get) => ...)` ergonomics with callbag-recharge's killer advantage: diamond-safe `select()` selectors backed by `derived()`. Added protocol-level `teardown()` utility for graph destruction. Ran adversarial code review (Blind Hunter + Edge Case Hunter) finding 8 issues — all fixed: initializer safety, replace semantics, action preservation, single source of truth, Object.hasOwn, cascading destroy.

**Key insight:** `select()` backed by `derived()` with push-phase memoization is architecturally superior to Zustand's manual selectors. `teardown()` fills a protocol gap — `complete()` exists on ProducerStore but not on WritableStore or derived nodes.

**Rejected:** Deep merge (matches Zustand shallow); implicit tracking (contradicts explicit deps); built-in React hook (framework-agnostic); select dedup/caching (unnecessary overhead).

**Outcome:** `createStore` pattern (production-ready, 31 tests), `teardown()` protocol primitive, patterns directory convention established.

### Session agentic-memory-research (March 17) — SOTA Agentic Memory Research + AI Tool Full-Chain Analysis
**Topic:** Research all major agent memory systems and AI tool surfaces to identify common patterns for callbag-recharge as a unified reactive state management layer

**Key insight:** No existing agent memory system uses reactive/push-based state management. All are pull-based (query → retrieve → return). Push-based dirty tracking + incremental computation is a genuinely novel contribution. In-process reactive stores eliminate serialization, deserialization, and TCP overhead entirely — 10,000x faster than Redis localhost.

**Rejected:** Job queues/Kafka for in-process agent state; Redis as a requirement; RBAC in core primitives.

**Outcome:** 6-phase plan from reactive KV store through knowledge graphs. Benchmark targets (10ns point read vs Redis 100μs). SESSION-agentic-memory-research.md.

### Session generic-utils-design (March 17) — Generic Utility Layer Design
**Topic:** Backoff strategies, eviction policies, circuit breaker, rate limiter — reusable strategy layer between extras and patterns

**Key insight:** Strategies are not nodes — they're pure functions/objects that configure behavior. Every utility has 3+ consumers across the ecosystem. Backoff is foundational (circuit breaker and retry both consume it). Eviction policy is the most broadly used (every bounded data structure needs one).

**Rejected:** Inlining strategies in each consumer; making utilities reactive nodes; building utilities only for Redis compat.

**Outcome:** Proposed `src/utils/` layer with 4 utilities. Build order: backoff → evictionPolicy → rateLimiter → circuitBreaker.

### Session redis-replacement-analysis (March 17) — Redis Drop-in Replacement Strategy + First-Principles Data Structure Redesign
**Topic:** What Redis actually is (5 things glued together), where we beat it (10,000x latency), first-principles redesign of reactive data structures for modern needs

**Key insight:** Three insights drove the redesign: (1) Design for modern needs first, Redis compat is a thin mapping layer. (2) The Map is the source of truth, stores are read-only derived views — eliminates the dual-state problem in kvStore. (3) Reactive score functions (reactiveIndex) are architecturally impossible in Redis.

**Rejected:** Copying all 7 Redis structures; making store(key) writable (dual source of truth); reactiveSet as separate primitive (derived + state<Set> suffices); designing for Redis API first.

**Outcome:** Three modern primitives: `reactiveMap` (redesigned kvStore with atomic update, getOrSet, eviction, namespace, single write path), `reactiveLog` (append log with reactive tail/slice, not a doubly-linked list), `reactiveIndex` (sorted index with reactive score functions). Plus `pubsub()` thin layer and ~100 line Redis compat mapping. kvStore code review findings (9 patch items) informed the reactiveMap redesign.

### Session level3-strategic-plan (March 17) — Level 3 Strategic Plan: Data Structures + Orchestration
**Topic:** Four-level progressive architecture (primitives → operators → data+orchestration → persistence+distribution), combining UniversalNode research, Redis replacement analysis, and agentic memory research into a concrete build plan

**Key insight:** Performance and completeness are not in conflict if heavy parts are pluggable. Level 3 gets 10ns reads with NodeV0 (id + version). Level 4 adds CID/caps on demand. The boundary between Level 3 and Level 4 is the performance firewall. Diamond resolution IS a DAG executor — no new scheduling engine needed.

**Rejected:** Eager CID on every set() (blows 10ns target); UniversalNode as mandatory base; Kafka/job queue for in-process state; copying all 7 Redis structures.

**Outcome:** Four-level architecture. Level 3 build order: reactiveMap → reactiveLog → reactiveIndex → collection refactor → NodeV0 → pubsub → fromCron+taskState. Module structure: `src/data/` (data structures), `src/memory/` (agent memory on top of data), `src/orchestrate/` (DAG/scheduling). kvStore replaced by reactiveMap.

### Session universal-data-structure-research (March 17) — Universal Data Structure from First Principles
**Topic:** First-principles research into the optimal "node" data structure for modern demands (web, Web3, AI, infrastructure) that pairs with callbag-recharge as the communication/edge layer

**Key insight:** Every domain (web, Web3, AI, infrastructure, IoT, data engineering) converges on 5 universal properties: reactive by default, streaming-native, lazy+push notification, explicit dependencies, self-describing metadata. The "mutable pointer to immutable data" pattern (Git refs→commits, IPFS IPNS→CID, our Store→UniversalNode) is the correct architecture. Content addressing gives integrity, dedup, caching, and diffing for free. Capability-based access matches callbag's existing protocol-level ocap model.

**Rejected:** CRDTs as base (100x metadata overhead); ACLs/RBAC (need central authority); always-eager content addressing (hash every write); FHE for access control (10,000-1,000,000x slower); single encoding format (need pluggable codecs).

**Outcome:** `UniversalNode<T>` interface with 7 irreducible properties (identity via dual id+CID, schema, versioning via version+prev chain, capability-based access, relationships via deps+refs, pluggable encoding with DAG-CBOR default, intrinsic+extrinsic metadata). Three-phase roadmap: V0 (+60B/node: id+version), V1 (+150B: +CID+prev+schema), V2 (+200B: +caps+refs+encryption). Audit of 30+ existing data structures/formats across 10 categories. Cross-domain demand analysis across 6 domains. Security & performance deep-dive.

---

### Session docs-site-patterns-streamFrom (March 17) — Docs Fixes, Single-Source Examples, switchMap Footgun → streamFrom Pattern
**Topic:** Fix broken docs site, establish single-source example strategy, identify critical usability issue with switchMap + propose streamFrom/cancellable patterns

**Key insight:** The 5-operator streaming tax (filter + switchMap + filter(undefined) + scan + filter) is a real usability problem. Even Claude got it wrong in 3 attempts. switchMap's eager initial evaluation is architecturally correct but ergonomically wrong. Higher-level patterns (`streamFrom`, `cancellable`) are required for adoption, not optional.

**Also done:** Fixed empty features/primitives on homepage (variable naming bug), established 5-tier docs model (JSDoc → examples/ → recipes → pattern READMEs → llms.txt), removed bundle-size auto-update CI, cleaned preact + callbag comparison deps, created createStore recipe with VitePress snippet imports.

**Rejected:** Fix switchMap eagerness (correct contract); MDX over VitePress (no benefit); blog engine (over-engineering).

**Outcome:** Broken site fixed, single-source example workflow established, streamFrom/cancellable patterns designed but NOT YET IMPLEMENTED.

### Session lazy-tier2-option-d3 (March 18) — Architecture Pivot: Lazy Tier 2 + Option D3
**Topic:** Fix switchMap footgun at the root — make Tier 2 operators lazy (no eager evaluation), add TypeScript-overloaded `initial` option, disconnect derived on last unsubscribe

**Key insight:** `ProducerStore<T>` already extends `Store<T | undefined>` — the "always has value" concern was a false constraint. Tier 2 operators are async by nature; `undefined` before first emission is the honest type. Option D3 (lazy + overloaded initial) matches TanStack Query / SWR / Solid `createResource` patterns that LLMs already know.

**Also decided:** Derived disconnect-on-last-unsub (memory win), `resetOnTeardown` for derived, naming pivot (`cancellable` → `fromAsync`, `streamFrom` → `fromStream`), subject.ts needs review.

**Rejected:** Option C hybrid (reconnection race during talkback handshake); Option B fully lazy (breaks state/derived get()); keep D_STANDALONE perpetual connection.

**Outcome:** Architecture pivot approved. Implementation: lazy switchMap → derived disconnect → other Tier 2 operators → tests. Streaming example drops from 5 operators to 3.

### Session b5498ba2 (March 18) — D5 Error Handling + dynamicDerived Primitive
**Topic:** Add try/catch error handling to derived/dynamicDerived, introduce dynamicDerived as a new core primitive, adversarial code review + fixes

Implemented dual error semantics for derived computation functions: push path catches errors and sends END(error) to subscribers; pull path re-throws to caller. Introduced `dynamicDerived(fn)` as a new core primitive with runtime dep discovery via tracking `get` function and automatic upstream rewiring. Ran adversarial code review (Blind Hunter + Edge Case Hunter) finding 17 issues — 5 fixed: late subscriber error propagation (P2), exception-safe multi-sink END dispatch (D1), operator late subscriber error (D2), `_recomputeIdentity` D_COMPLETED guard (D3), subscribe.ts get() safety.

**Key insight:** try/catch has zero V8 overhead on happy path (JIT compiles try body normally). Error storage in `_cachedValue` (dual-use field) avoids per-instance allocation for the rare error case. Operator needs separate `_errorData` because `_value` can be reset by `resetOnTeardown`.

**Rejected:** Letting errors bubble up uncontrolled (breaks callbag contract); separate `_error` field on derived (unnecessary allocation); only push-path error handling (inconsistent get() behavior).

**Outcome:** 6 core primitives (producer, state, derived, dynamicDerived, operator, effect). 1574 tests passing. Two behavioral changes: fn errors → END(error) instead of bubbling, get() on ERRORED throws.

### Session f47ed59e (March 18) — Skip DIRTY, Cached Operator, and Code Review Fixes
**Topic:** Four optimizations (SINGLE_DEP signaling, reduced bound methods, streamlined transitions, `cached()` operator) + adversarial code review fixes

**Key insight:** SINGLE_DEP signaling via the callbag talkback reverse channel enables source-side DIRTY skip without API changes. For single-dep subscribers in unbatched paths, DIRTY is pure overhead — DATA follows synchronously. The `_singleDepCount` field (8 bytes/store) enables MULTI→SINGLE restoration, preserving the optimization across subscriber lifecycle changes.

**Code review findings (3 fixed):** P1: Stale P_SKIP_DIRTY on complete/error (resubscribable safety). P2: Multi-dep cached diamond glitch (added Bitmask dirty-dep counting). D1: MULTI→SINGLE P_SKIP_DIRTY restoration (added `_singleDepCount` tracking).

**Rejected:** Drop MULTI→SINGLE restoration (simpler but loses optimization permanently); alternative to `_singleDepCount` (can't query remaining sink after transition).

**Outcome:** 50% dispatch reduction for single-dep unbatched paths. `cached()` extra with factory + pipe forms. All 1316 tests passing.

### Session edge-llm-strategy (March 19) — Edge LLM Trend Research & Opportunity Analysis
**Topic:** How the LLM-on-edge trend affects callbag-recharge and opportunities for positioning

Research across edge LLM landscape (Ollama, WebLLM, ExecuTorch, Apple Foundation Models, React Native ExecuTorch), TypeScript LLM SDKs (Vercel AI SDK 20M+ downloads, LangGraph.js, LlamaIndex.TS), and developer pain points.

**Key insight:** Reactive LLM state management is the widest-open whitespace in the ecosystem — zero existing solutions. Every callbag-recharge primitive maps directly to an edge LLM need. The gap is packaging (patterns, adapters) and discoverability (GEO), not primitives.

**Rejected:** Build own inference runtime; React-specific hooks; full LLM orchestration framework; target only browser inference.

**Outcome:** Roadmap updated with Phase 5e-h (fromLLM adapter, toolCallState pattern, hybridRoute pattern, structured streaming parser), Phase 4 expanded with edge LLM GEO targets, positioning vs Vercel AI SDK and edge inference runtimes, Edge LLM Opportunity section in Strategic Context.

### Session orchestration-strategy (March 18–19) — Reactive Workflow Engine Strategy → Fully Shipped
**Topic:** Research user pain points across n8n, Airflow, Jenkins, Dify, Coze, LangGraph, CrewAI, Temporal, Inngest — design and implement reactive orchestration primitives

**Key insight:** The airflow demo fell back to imperative async/await because higher-level pipe wiring doesn't exist. The original Level 3 vision (pure reactive pipes) was correct but unimplemented. "workflowTask" config-object pattern rejected as unintuitive — everything should be a composable pipe operator.

**Rejected:** Monolithic `workflowTask({ retries, timeout, breaker })` config; DAG executor as separate engine (derived() IS the executor); static DAGs only (AI era demands dynamic/cyclic graphs).

**Outcome (Phase 1+2 shipped):** All 7 orchestration operators implemented: `gate()`, `track()`, `route()`, `withBreaker()`, `withRetry()`, `withTimeout()`, `fromTrigger()`. Plus `pipeline()` declarative builder, `checkpoint()` with pluggable adapters, `fromWebhook()`/`fromWebSocket()`/`toWebSocket()` adapters, and `airflow-demo-v2.ts` proving "n8n in 50 lines." Gap analysis identified persistence adapters and execution logging as the next priorities to move from demo to production.

### Session text-editor-lego-plan (March 19) — Generic Legos + Text Editor Build Plan
**Topic:** Audit existing patterns/utils for missing intermediate building blocks, design 10 reusable legos, compose into text editor pattern

**Key insight:** The gap between core primitives and full patterns (chatStream, agentLoop) is too wide. Mid-size legos (dirtyTracker, selection, commandBus, validationPipeline) both stress-test library correctness (diamond resolution, batch atomicity, cleanup) and serve as reusable blocks for many downstream tools beyond the editor.

**Rejected:** Build editor monolithically (no reuse); put reactive patterns in utils/ (violates import rules); reactiveList as reactiveMap wrapper (O(n) key remapping); build markdown parser in-library (rendering concern, not state).

**Outcome:** 3-phase build plan. Phase 1: extract dirtyTracker + validationPipeline + asyncQueue from existing patterns. Phase 2: new primitives (selection, reactiveList, timer, commandBus, focusManager). Phase 3: compose into textBuffer → textEditor → examples. 13 steps total, 10 independently testable legos.

### Session repo-audit-design-principles (March 20) — Full Repo Audit + Design Principles Codification
**Topic:** Comprehensive audit of all 138 modules against architecture doc, new design principles, import hierarchy unification, companion store standardization

**Key insight:** The codebase already converged on companion stores (8 modules) — taskState's packed `TaskMeta` is the lone outlier, not a deliberate alternative. `batch()` is the companion store's secret weapon: without it, transitioning 4 companion stores means 4 effect runs; with it, 1. The `inner` property pattern (pioneered by `pipeline().inner`) should be the standard for hiding callbag internals in high-level APIs.

**Also decided:** 5-tier import hierarchy (core → extra → utils → orchestrate/memory → patterns/adapters/compat), data as cross-cutting layer, intra-folder imports blessed, adapters can now import from utils/. §1.14 principle: high-level layers speak domain language, not callbag.

**Rejected:** Move withStatus to core (utility, not foundation); keep packed TaskMeta (8:1 ratio against); keep adapter core-only import rule (forced duplication); file-level inventory in docs (user: "don't care about counts").

**Outcome:** Architecture doc §1.14, §2, §19 updated. reactiveList extends NodeV0. Phase 5a (Uniform Metadata Pattern) added to roadmap. API leakage audit found 11 violations: 2 type-level (taskState.source, task._taskState), 8 JSDoc (DIRTY/RESOLVED/END terminology in gate, branch, pipeline, adapters, createStore), 1 export-level (createStore re-exports teardown). All tracked in Phase 5a-0.

---

## Additional Sessions (Partial Coverage)

- Session 269923a2 (Mar 14) — Implementation plan for two-phase push
- Session 05b247c1 (Mar 14) — Pure callbag refactor (explicit deps)
- Session 3844edd6 (Mar 14) — Batch 2 implementation
- Session 69f77860 (Mar 15) — Batch 3 implementation
- Session 660b129d (Mar 15) — Equals option wiring and bench fixes
- Session 344b81ab (Mar 15) — Extras refactoring with operator primitive
- Session 476164b4 (Mar 15) — Optimizations doc and opportunities
- Session f23a9e35 (Mar 15) — Distinguishing pipeRaw vs pipeDerived
- Session ac72cc83 (Mar 16) — V4 design review
- Session 4cb2d590 (Mar 16) — Implement remaining extras
- Session b1e8b5e5 (Mar 16) — Promote v4, update all docs

---

## Reading Guide

**For architecture newcomers:**
1. Start with 8452282f (Type 3 breakthrough)
2. Then ce974b95 (Push-phase memoization)
3. Then 8693d636 (Output slot)
4. Then 2d2c2674 (ADOPT removal)
5. Then 88e9bd81 (Benchmarks)

**For understanding design trade-offs:**
- 47f1a07f (Library comparison)
- 88e9bd81 (Cost of correctness)
- 4f72f2b0 (No-default-dedup rationale)

**For implementation details:**
- ecc3a7e6 (Bug fixes and design contracts)
- Session files are ordered chronologically by date

---

## Key Themes

### Unification Under Callbag
The core philosophy: use callbag protocol cleanly. Type 3 for control signals, type 1 for data, standard two-phase push. No split channels, no special protocols.

### Explicit Dependencies
Chosen over implicit tracking (Jotai model) because it's clearer, more debuggable, and scales to complex graphs.

### Correctness First, Performance Second
Trade memory for observability. Trade throughput for diamond resolution correctness. Recharge wins on state operations; competitive on computed and diamonds.

### Transparency in Operators
Extras are pass-through by default. Dedup is opt-in (distinctUntilChanged). Batching is explicit. No magic.

### Design Iteration
Some decisions evolved through implementation (ADOPT protocol removed after output slot clarified). This is healthy — iterate towards clarity.

---

## Archive Format

Each session file contains:
- SESSION ID and DATE
- TOPIC
- KEY DISCUSSION (the actual reasoning, quotes, code examples)
- REJECTED ALTERNATIVES (what was considered, why not)
- KEY INSIGHT (the main takeaway)
- FILES CHANGED (implementation side effects)

This format preserves the thinking process, not just conclusions.

---

**Created:** March 16, 2026
**Archive Status:** Complete through callbag-native Promise elimination (March 24, 2026)

### Gemini Marketing Research (March 21) — Market Positioning & Growth Strategy
**Topic:** Competitive landscape analysis, agentic AI trends, streaming durability gap, and developer marketing strategy for callbag-recharge

External deep research (via Gemini Voyager) covering: the 2025–2026 agentic enterprise surge (282% AI adoption growth), the "trust bottleneck" in autonomous agent systems, the streaming durability crisis in LLM implementations, and the signals-vs-streams debate in the TC39 era.

**Key insights:**
- **Agentic trust gap:** Every-node-is-inspectable architecture is a direct differentiator vs opaque frameworks (LangGraph, CrewAI, AutoGen).
- **Streaming durability crisis:** Library-native checkpoint persistence + resumable streams fills a void between fragile UI streaming and heavy enterprise orchestrators (Temporal, Inngest, DBOS Transact).
- **"Missing middle" positioning:** TC39 Signals handle UI state; RxJS/streams handle complex async. callbag-recharge bridges both paradigms with simple Store API + full stream power.
- **Vibe coding safety rail:** Glitch-free two-phase push model provides verifiable state transitions for AI-generated code.
- **Lightweight durable execution:** Zero-dependency, library-native durability for edge/local-first/on-device AI — a market niche underserved by server-dependent tools.

**Competitor mapping:**
- State management: Zustand, Jotai, Redux, TC39 Signals, Preact Signals, SolidJS
- AI orchestration: LangGraph, Mastra, Vercel AI SDK, OpenAI Agents SDK, Google ADK
- Durable execution: Temporal, Inngest, Trigger.dev, DBOS Transact
- Workflow: n8n, Airflow, Prefect, XState

**Growth strategy:** "Reuse flywheel" via 90-9-1 community principle. Utility-first content (architecture deep-dives, durable stream blueprints). Compat wrappers as low-friction Trojan horse. Target niches: local-first AI, edge compute, TypeScript agentic frameworks.

**Source:** `callbag-marketing-research-20260321-161450.md` (Gemini Voyager deep research export, ~1144 lines of iterative analysis across 100+ web sources)

### Session openclaw-mem0-analysis (March 23) — OpenClaw/Mem0 Integration Analysis
**Topic:** What the OpenClaw + Mem0 integration means for callbag-recharge's memory layer positioning, Phase 6 priority, and competitive differentiation

OpenClaw (desktop/cloud AI agent) integrated Mem0 as built-in memory — validating demand for structured agent memory backends. Analysis cross-referenced with original agentic memory research (March 17) and edge LLM strategy (March 19).

**Key insights:**
- **Mem0 is pull-only; we're push-based.** Memory nodes that push score changes downstream + auto-invalidate cached contexts is a genuinely novel differentiator no competitor has.
- **In-process HNSW (Phase 6b) is the biggest concrete gap vs Mem0.** ~1-10μs vs ~50-500μs on the most expensive retrieval operation.
- **Admission control needs a first-class API.** Phase 6d should expose `admissionPolicy` on `collection`.
- **"Slim collection" variant (Phase 6e)** for high-throughput paths skipping reactive eviction.
- **Don't add LLM extraction calls in primitives.** Keep memory primitives pure — LLM extraction belongs in patterns/ layer.

**Outcome:** Phase 6 reordered (6b→6d→6a→6c), 6e added (lightCollection), roadmap updated with market validation context, SESSION-agentic-memory-research.md and SESSION-edge-llm-strategy.md updated.

### Session worker-bridge-h2-design (March 22) — Worker Bridge + H2 AI Chat Design
**Topic:** Reactive cross-thread communication — abstracting Web Workers, SharedWorkers, Service Workers behind callbag stores. H2 hero app architecture with three workers.

Research into 8 major pain points with browser worker APIs (no streaming, no cancellation, no shared state, serialization overhead, lifecycle leaks), existing library landscape (Comlink, threads.js, observable-webworker), and WebLLM's built-in worker support.

**Key insights:**
- **The worker channel IS a stream** — Comlink/RPC fights this by modeling it as request/response. callbag stores embrace the streaming nature.
- **Meet libraries at their boundary** — WebLLM already abstracts its worker communication. Don't re-wrap it. Bridge at the `AsyncIterable` boundary. Our bridge is for workers where WE own the communication (memory, embeddings, data processing).
- **Three workers, three roles** — Web Worker for compute (WebGPU/inference), SharedWorker for shared state (cross-tab memory + IndexedDB), Service Worker for caching (model weights).
- **Only settled values cross the wire** — DIRTY/RESOLVED stays local. `batch()` coalesces rapid `set()` calls into one `postMessage`.

**Rejected:** Wrapping WebLLM's worker in our bridge (they already abstract it); SharedArrayBuffer as default (breaks COOP/COEP); sending DIRTY/RESOLVED across wire (doubles traffic); Comlink-style RPC (fights streaming nature).

**Outcome:** Phase 5g (Worker Bridge) added to roadmap. H2 AI Chat updated with three-worker architecture. `workerBridge()`/`workerSelf()` API designed with `WorkerTransport` abstraction for all 4 transport types.

### Session callbag-native-promise-elimination (March 24) — Callbag-Native Promise Elimination
**Topic:** Full audit of 176 Promise/await usages across 53 files; plan to make every API callbag-in/callbag-out; eliminate internal `firstValueFrom` usage; break pre-1.0 APIs

Comprehensive audit found that while §1.16 ("no raw `new Promise`") was mostly followed, the deeper issue was that internal APIs returned Promises or consumed Promises directly, breaking reactive continuity. Philosophy shift: the library should be callbag-in, callbag-out everywhere. Promise bridges are only for end-users exiting callbag-land.

**Key insights:**
- **`firstValueFrom` was overused internally.** It bridges callbag→Promise, but most internal consumers don't need Promises — they should stay in callbag-land.
- **User callbacks should use `rawFromAny`.** Not limited to Promise — accepts sync values, Promises, AsyncIterables, or callbag sources for maximum flexibility.
- **`rawFromAsyncIter(response.body)` is more direct** than manual reader loops for streaming.
- **`raw/race` operator** replaces `Promise.race` pattern (timeout racing, poll-vs-timeout). Extra version for Store-level use.
- **Promise output is a convenience wrapper, not the primary API.** Like `node:fs/promises` to `node:fs` — consider post-1.0 for adoption.

**New raw primitives:** `fromPromise`, `fromAsyncIter`, `fromAny`, `race` — all zero core deps.

**APIs broken:** `rateLimiter.acquire()`, `asyncQueue.enqueue()`, `CheckpointAdapter`, `ExecutionLogPersistAdapter`, `connectionHealth` callbacks, `webhook.listen()`, `sse.listen()` — all switch from Promise to callbag source returns.

**Rejected:** Keep Promise APIs for convenience (breaks reactive continuity); only fix `new Promise` literals (misses deeper issue); add `forkJoin` immediately (wait for recurrence).

**Outcome:** Architecture §1.20 (callbag-native output), CLAUDE.md replacement patterns, roadmap in-progress item. Implementation deferred to next session.

---

## Archived Documents (formerly in docs/)

These documents were moved to archive because their content became stale or was superseded by canonical docs. They preserve historical context but should not be treated as current truth.

| File | Original location | Why archived | Date archived |
|------|-------------------|-------------|---------------|
| `state-management.md` | `docs/state-management.md` | Strategy doc with stale gap analysis (gaps filled), stale package structure, stale operator counts. Landscape research and GEO strategy remain useful as historical context. | 2026-03-19 |
| `extras.md` | `docs/extras.md` | Module listing with stale operator/pattern/adapter counts. Roadmap sections for patterns/compat/adapters already shipped. Superseded by JSDoc (source of truth) + `docs/architecture.md` folder hierarchy. | 2026-03-19 |
| `roadmap-v0.4.0-shipped.md` | `docs/roadmap.md` | Full roadmap snapshot at v0.4.0 release including all shipped phases. Current `docs/roadmap.md` contains only in-progress/backlog. | 2026-03-19 |
