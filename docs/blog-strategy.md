# Documentation & Blog Strategy

> **Goal:** Build public-facing docs + engineering blog to promote callbag-recharge.
> Unified site (docs + blog under one domain) for consolidated SEO authority.

---

## Phase 1: Pre-Publish (Now)

Focus on the README and in-repo docs. No external site yet.

| Asset | Priority | Status |
|-------|----------|--------|
| **README.md** — killer README with "State that flows" tagline, 10-line example, comparison table, bundle size | P0 | TODO |
| **llms.txt** — simple machine-readable summary in repo root | P1 | TODO |
| **docs/** — architecture, API reference (already exist) | P1 | Done |
| **src/archive/docs/** — recovered historical docs for blog material | P1 | Done |
| **VitePress blog** — `/blog/` section with sidebar, Arc 1 written | P1 | Done |

## Phase 2: Post-Publish (When Users Arrive)

VitePress docs site is live with unified `/blog/` section.

```
site/
├── /api/           ← API reference
├── /recipes/       ← Recipes & migration guides
├── /comparisons/   ← vs Zustand, Jotai, RxJS, etc.
├── /demos/         ← Interactive demos
├── /architecture/  ← Design & internals
└── /blog/          ← engineering evolution posts (Arc 1 shipped)
```

### Tool Choice

**VitePress** (lighter, zero-config for TS libraries). Migrate to **Starlight (Astro)** later if you need structured data, i18n, or interactive island components.

### Why unified (not separate blog)?

- Subfolder structure (`/docs`, `/blog`) consolidates domain authority
- Single `llms.txt` indexes both API docs and blog content
- Cross-linking from blog posts to API docs uses relative paths
- One build, one deploy, one analytics property

---

## Blog Content Plan: "The callbag-recharge Chronicle"

### Content Formula

Each "engineering evolution" post follows this pattern:

1. **The Context** — "In v2, we did X because it seemed simple."
2. **The Pitfall** — "We discovered that as the graph grew, X led to Y."
3. **The Insight** — "We realized the callbag protocol actually allows Z."
4. **The Solution** — "In v4, we implement [pattern]. Here's the code."

### Chronicle Blog Series (29 posts across 8 arcs)

#### Arc 1: Origins — Why Revive Callbag? ✅ SHIPPED (March 24, 2026)

| # | Title | File | Status |
|---|-------|------|--------|
| 1 | **Callbag Is Dead. Long Live Callbag.** | `site/blog/01-callbag-is-dead-long-live-callbag.md` | Done |
| 2 | **The Protocol That Already Solved Your Problem** | `site/blog/02-the-protocol-that-already-solved-your-problem.md` | Done |
| 3 | **Signals Are Not Enough** | `site/blog/03-signals-are-not-enough.md` | Done |

#### Arc 2: Architecture v1 — The Naive First Attempt ✅ SHIPPED (March 24, 2026)

| # | Title | File | Status |
|---|-------|------|--------|
| 4 | **Push Dirty, Pull Values: Our First Diamond Solution** | `site/blog/04-push-dirty-pull-values-our-first-diamond-solution.md` | Done |
| 5 | **Why Explicit Dependencies Beat Magic Tracking** | `site/blog/05-why-explicit-dependencies-beat-magic-tracking.md` | Done |
| 6 | **The Inspector Pattern: Observability as a First-Class Citizen** | `site/blog/06-the-inspector-pattern-observability-as-first-class-citizen.md` | Done |

Source material: `src/archive/docs/architecture-v1.md`; session `47f1a07f` (explicit deps); `SESSION-inspector-hooks-wiring.md` + v1/v3 Inspector sections (WeakMap, hooks, `observe()`).

#### Arc 3: Architecture v2 — The Great Unification

| # | Title | Source Material |
|---|-------|----------------|
| 7 | **Data Should Flow Through the Graph, Not Around It** | `architecture-v2.md` — v1→v2 aha moment |
| 8 | **Two-Phase Push: DIRTY First, Values Second** | Session 269923a2 — two-phase push implementation |
| 9 | **From Pull-Phase to Push-Phase Memoization** | Session ce974b95 — memoization debate |

#### Arc 4: Architecture v3 — The Type 3 Breakthrough

| # | Title | Source Material |
|---|-------|----------------|
| 10 | **The Day We Read the Callbag Spec (Again)** | Session 8452282f — type 3 breakthrough brainstorm |
| 11 | **Why Control Signals Don't Belong in the Data Stream** | `architecture-v3.md`, sessions 8452282f + 8601463b |
| 12 | **RESOLVED: The Signal That Skips Entire Subtrees** | Session ce974b95 — push-phase memoization cascade |
| 13 | **Five Primitives, Two Tiers, Zero Schedulers** | v3 primitive unification (producer, state, derived, operator, effect) |

#### Arc 5: Architecture v4 — Performance Without Compromise

| # | Title | Source Material |
|---|-------|----------------|
| 14 | **Output Slot: How null→fn→Set Saves 90% Memory** | Session 8693d636 — lazy allocation |
| 15 | **When We Removed the ADOPT Protocol** | Session 2d2c2674 — simplification |
| 16 | **Lazy Tier 2: The switchMap Footgun We Had to Kill** | Session lazy-tier2-option-d3 |
| 17 | **Bitmask Flag Packing in TypeScript** | Session 476164b4 — V8 hidden class optimization |

#### Arc 6: Correctness Stories

| # | Title | Source Material |
|---|-------|----------------|
| 18 | **Diamond Resolution Without Pull-Phase Computation** | Session ce974b95, `architecture.md` §8 |
| 19 | **When Not to Dedup: Understanding Callbag Operator Semantics** | Session 4f72f2b0 — no-default-dedup decision |
| 20 | **Benchmark Regression Exposed 3 Operator Bugs** | Session ecc3a7e6 — benchmarks as design validators |
| 21 | **The Cost of Correctness: 9.8M ops/sec vs Preact's 34M** | Session 88e9bd81 — honest benchmarking |

#### Arc 7: From Library to Platform

| # | Title | Source Material |
|---|-------|----------------|
| 22 | **Stores All the Way Down: Adding State to Reactive Programming** | Store interface design, `get()/set()/source()` |
| 23 | **Why Our Computed States Are Eagerly Reactive** | Sessions 12795037 + f23a9e35 — STANDALONE mode |
| 24 | **From Zustand to Reactive Orchestration** | Compat layer strategy, `createStore` pattern |
| 25 | **The Missing Middle: Why Signals Aren't Enough for AI Streaming** | TC39 debate, Gemini research §Signals vs Streams |

#### Arc 8: Engineering Deep Cuts (Bonus)

| # | Title | Source Material |
|---|-------|----------------|
| 26 | **switchMap Error Handling: The Bug That Tests Didn't Catch** | Session f9dc5740 |
| 27 | **Skip DIRTY: How We Halved Dispatch for Single-Dep Paths** | Session f47ed59e — SINGLE_DEP signaling |
| 28 | **Bitmask Overflow at >32 Dependencies** | Session 67ad8cc6 — 863-test suite |
| 29 | **Why We Don't Use queueMicrotask (And Neither Should You)** | Architecture §1.18 — microtask breaks glitch-free |

### Market-Positioning Posts (standalone, from Gemini marketing research)

These are independent of the chronicle arc and can be published in any order:

| # | Topic | Source Material | Why It Matters |
|---|-------|----------------|----------------|
| M1 | **"Durable Reactive Streams: LLM Responses That Survive Network Failures"** | Gemini research §Durability Crisis, checkpoint adapters | Solves acute pain point — high viral potential in AI dev communities |
| M2 | **"The Trust Bottleneck: Observable State for Agentic AI"** | Gemini research §Agentic Trust, Inspector architecture | Thought leadership for the agentic enterprise wave |
| M3 | **"Zero-Dependency Orchestration: callbag-recharge vs Temporal/Inngest/DBOS"** | Gemini research §Lightweight Durability, orchestrate layer | High search intent — developers frustrated with heavy infra |
| M4 | **"Vibe Coding Safety Rails: Why Your AI-Generated Code Needs Verifiable State"** | Gemini research §Vibe Coding Risks, architecture §1.15 | Timely hook into vibe coding trend |
| M5 | **"From Zustand to Reactive Orchestration: The Compatibility Wrapper Strategy"** | Gemini research §Trojan Horse, compat layers | Migration guide that doubles as adoption content |

---

## Discovery & Promotion Strategy

### Primary channels (for an OSS library)

1. **npm** — accurate keywords, good description
2. **GitHub** — README, stars, topics
3. **Dev communities** — dev.to, Reddit r/javascript, HN
4. **Word of mouth** — blog posts shared in relevant discussions

### Niche communities (high-intent, from Gemini research)

Target these specific sub-communities where our differentiators resonate most:

- **r/AI_Agents, r/LangChain, r/LocalLLaMA** — agentic AI developers frustrated with opaque frameworks
- **r/typescript** — TypeScript-native AI tooling demand (LangGraph.js TS-native design thread)
- **HN "durable execution" threads** — DBOS/Temporal/Inngest comparisons draw our exact audience
- **Dev.to AI agent architecture posts** — high engagement on "building AI agents with TS" content
- **Edge/local-first communities** — Heavybit, local-first.dev, Offline First community

### Growth model: "Reuse Flywheel" (90-9-1 principle)

1. **Solve one acute pain point** — durable LLM streams that survive network failures
2. **Syndicate blueprints** — architecture deep-dives on high-authority platforms
3. **Compat wrappers as Trojan horse** — Zustand/Jotai users upgrade without rewriting
4. **Core dependency adoption** — tool becomes standard in production repos
5. **Contributors emerge** — 9% create content, 1% contribute code

### Secondary (Phase 2+)

- `llms.txt` at site root for AI agent discovery
- JSON-LD structured data (if using Starlight)
- Context7 / similar npm indexing tools

### What NOT to over-invest in early

- Heavy SEO/GEO optimization (your audience finds libraries through npm/GitHub/community, not Google SERP)
- `llms.txt` driving architecture decisions
- i18n (premature for a pre-1.0 library)

---

## Source Material Inventory

### Archived docs (recoverable blog material)

| File | Location | Content |
|------|----------|---------|
| `architecture-v1.md` | `src/archive/docs/` | Original architecture — dual-channel, pull-phase |
| `architecture-v2.md` | `src/archive/docs/` | Two-phase push on single DATA channel |
| `architecture-v3.md` | `src/archive/docs/` | Type 3 control channel introduction |
| `test-plan.md` | `src/archive/docs/` | Original test plan |

### Current docs (reference)

| File | Location | Content |
|------|----------|---------|
| `architecture.md` | `docs/` | Canonical — output slot, STANDALONE, chain model |
| `architecture-v4-review.md (archived)` | `docs/` | Review notes, error asymmetry, trade-offs |
| `state-management.md` | `src/archive/docs/` | Competitive landscape & positioning (archived) |
| `benchmarks.md` | `docs/` | Performance data |
| `optimizations.md` | `docs/` | V8 optimization techniques |

### Key Claude Code sessions (blog extraction candidates)

| Session | Date | Topic |
|---------|------|-------|
| 8452282f | Mar 14 | Type 3 breakthrough brainstorm |
| 8601463b | Mar 14 | V3 implementation with universal Producer |
| ce974b95 | Mar 14 | Push-phase memoization debate |
| 47f1a07f | Mar 15 | Library comparison research |
| 476164b4 | Mar 15 | Bitmask flag packing |
| 4f72f2b0 | Mar 15 | No-default-dedup decision |
| f9dc5740 | Mar 15 | switchMap bug discovery |
| ecc3a7e6 | Mar 15 | Benchmark regression → 3 bugs |
| 12795037, f23a9e35 | Mar 15-16 | STANDALONE mode design |
| 8693d636 | Mar 16 | V4 output slot optimization |
| 2d2c2674 | Mar 16 | ADOPT protocol removal |
| 88e9bd81 | Mar 16 | V4 benchmarks |
| 67ad8cc6 | Mar 16 | 863-test suite, bitmask overflow |
| ac72cc83 | Mar 16 | Architecture review |
