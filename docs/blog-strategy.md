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

## Phase 2: Post-Publish (When Users Arrive)

Deploy a docs site (VitePress or Starlight) to GitHub Pages with custom domain.

```
site/
├── /docs/          ← API reference, guides, recipes
│   ├── getting-started
│   ├── api/
│   │   ├── state
│   │   ├── derived
│   │   ├── producer
│   │   ├── operator
│   │   └── effect
│   ├── recipes/
│   └── architecture/
└── /blog/          ← engineering evolution posts
```

### Tool Choice

**Start with VitePress** (lighter, zero-config for TS libraries). Migrate to **Starlight (Astro)** later if you need structured data, i18n, or interactive island components.

### Why unified (not separate blog)?

- Subfolder structure (`/docs`, `/blog`) consolidates domain authority
- Single `llms.txt` indexes both API docs and blog content
- Cross-linking from blog posts to API docs uses relative paths
- One build, one deploy, one analytics property

---

## Blog Content Plan

### Content Formula

Each "engineering evolution" post follows this pattern:

1. **The Context** — "In v2, we did X because it seemed simple."
2. **The Pitfall** — "We discovered that as the graph grew, X led to Y."
3. **The Insight** — "We realized the callbag protocol actually allows Z."
4. **The Solution** — "In v4, we implement [pattern]. Here's the code."

### Blog Topics (Prioritized)

#### Quick Wins (2-3 hrs each)

| # | Topic | Source Material | Why It Matters |
|---|-------|----------------|----------------|
| 1 | **"When Not to Dedup: Understanding Callbag Operator Semantics"** | Session 4f72f2b0 — found & fixed incorrect dedup in subscribe | Teaches callbag philosophy, contrasts with RxJS defaults |
| 2 | **"Output Slot: Memory-Efficient Multicast"** | Session 8693d636 — `null → fn → Set` saves ~200 bytes/node | Concrete V8 optimization story, easy to benchmark |
| 3 | **"Bitmask Flag Packing in TypeScript"** | Session 476164b4 — saves 16+ bytes/store via hidden class opt | Applicable beyond this library |

#### Medium Posts (5-8 hrs each)

| # | Topic | Source Material | Why It Matters |
|---|-------|----------------|----------------|
| 4 | **"Why Control Signals Don't Belong in the Data Stream"** | v2→v3 transition, sessions 8452282f + 8601463b, `architecture-v3.md` | Most unique insight — explains what makes callbag-recharge different |
| 5 | **"Why Our Computed States Are Eagerly Reactive"** | Sessions 12795037 + f23a9e35 — STANDALONE mode | Contrasts with Preact Signals/SolidJS lazy approach |
| 6 | **"Diamond Resolution Without Pull-Phase Computation"** | Session ce974b95, `architecture.md` §8 | Core correctness story |

#### Deep Dives (10+ hrs each)

| # | Topic | Source Material | Why It Matters |
|---|-------|----------------|----------------|
| 7 | **"From Dual-Channel to Two-Phase Push: v1→v4 Journey"** | All architecture docs + archived v1/v2/v3 | The definitive "evolution of design" post |
| 8 | **"The Cost of Correctness"** | Session 88e9bd81 — 9.8M ops/sec vs Preact 34M, but correct diamonds | Honest benchmarking builds trust |
| 9 | **"Callbag-Recharge vs Zustand/Jotai/SolidJS"** | Session 47f1a07f, `state-management.md` | Maps mental models across libraries |

### Bonus Topics (from bugs & discoveries)

| Topic | Source |
|-------|--------|
| "switchMap Error Handling: The Bug That Tests Didn't Catch" | Session f9dc5740 |
| "Benchmark Regression Exposed 3 Operator Bugs" | Session ecc3a7e6 |
| "Bitmask Overflow at >32 Deps" | Session 67ad8cc6 — 863-test suite |
| "Why We Removed the ADOPT Protocol" | Session 2d2c2674 — "measure first, speculate later" |

---

## Discovery & Promotion Strategy

### Primary channels (for an OSS library)

1. **npm** — accurate keywords, good description
2. **GitHub** — README, stars, topics
3. **Dev communities** — dev.to, Reddit r/javascript, HN
4. **Word of mouth** — blog posts shared in relevant discussions

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
| `state-management.md` | `docs/` | Competitive landscape & positioning |
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
