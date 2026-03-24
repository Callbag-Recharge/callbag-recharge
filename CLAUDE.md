# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**pnpm workspace** (root = library, `site/` = docs). `corepack enable` then `pnpm install` (or `mise run bootstrap`). See `CONTRIBUTING.md` for commit conventions (semantic-release on `main`).

- **Build:** `pnpm run build` (tsup → ESM + CJS + .d.ts into `dist/`)
- **Test:** `pnpm test` (vitest run)
- **Test watch:** `pnpm run test:watch`
- **Single test:** `pnpm exec vitest run src/__tests__/core/basics.test.ts`
- **Lint:** `pnpm run lint` (biome check)
- **Lint fix:** `pnpm run lint:fix`
- **Format:** `pnpm run format`
- **Benchmarks:** `pnpm run bench` (Vitest + tinybench). Focused: `bench:core`, `bench:data`
- **Bundle size:** `pnpm run size`

## Architecture

callbag-recharge is a reactive state management library where **every store is a callbag source**. The callbag protocol (START=0, DATA=1, END=2, STATE=3) is the internal wiring; users interact through a simple `Store` interface (`get()`, `set()`, `source()`).

**6 core primitives:** `producer`, `state`, `derived`, `dynamicDerived`, `operator`, `effect`. 180+ modules across 13 categories (core, raw, extra, utils, data, messaging, memory, orchestrate, patterns, worker, adapters, compat, ai). See [docs/architecture.md](docs/architecture.md) for the full design (protocol, signal handling, lifecycle signals, diamond resolution, output slot model, error handling).

## Key docs (read when relevant, not every conversation)

| Doc | What it covers | When to read |
|-----|----------------|-------------|
| [docs/architecture.md](docs/architecture.md) | Protocol, primitives, signal flow, dependency hierarchy, folder structure | Modifying core, adding operators, import rule questions |
| [docs/roadmap.md](docs/roadmap.md) | In-progress and backlogged work only | Planning new features |
| [docs/docs-guidance.md](docs/docs-guidance.md) | JSDoc → generated API docs → site pipeline | Writing/updating documentation |
| [docs/test-guidance.md](docs/test-guidance.md) | Test organization, patterns, Inspector tools | Writing tests |
| [docs/optimizations.md](docs/optimizations.md) | Built-in and potential optimizations | Performance work |

## Design invariants

- **Control flows through the graph, not around it** (architecture.md §1.15). Lifecycle events (reset, cancel, pause) must propagate as TYPE 3 STATE signals — never as imperative method calls that bypass the graph topology. AbortSignal bridges STATE to imperative async but is not the primary mechanism. Litmus test: if a new node needs registering in a flat list for lifecycle management, the design is wrong.
- **Signal-first for orchestrate**: When implementing any orchestrate node (`task`, `forEach`, `sensor`, etc.), the `signal: AbortSignal` is always the first parameter to user callbacks. Values follow as array (for deps) or positional args (for fixed-arity callbacks).
- **No raw `new Promise`** (architecture.md §1.16). Use callbag primitives (`fromTimer`, `producer`) and `firstValueFrom` (the ONE bridge in `raw/`) instead of hand-rolling Promises. `src/raw/` is the foundation layer — pure callbag protocol with zero core dependencies. Dependency hierarchy: `raw/` → `core/` → `extra/` → `utils/` → higher layers. `raw/` is importable from any folder.
- **Push/pull via callbag, never poll** (architecture.md §1.17). Wait for conditions via reactive stores + `firstValueFrom`, not `setInterval` loops.
- **No `queueMicrotask`/`setTimeout` for reactive coordination** (architecture.md §1.18). Use `effect` or `derived` to chain reactive updates — never `queueMicrotask`, `setTimeout`, or `Promise.resolve().then()`. Microtask scheduling breaks glitch-free guarantees. Timer usage only at true system boundaries (e.g. `fromTimer` for demo latency).
- **Prefer `subscribe` over `effect` for single-dep data sinks** (architecture.md §1.19). Use `subscribe` when: single store dep, no diamond risk, no cleanup return, just react to value changes. Use `effect` for multi-dep diamond resolution or when DIRTY/RESOLVED guarantee is needed. `subscribe` has no DIRTY/RESOLVED overhead — measured 58x faster on the eviction hot path.

## Examples & docs (single source of truth)

- **All library logic lives in `examples/`.** Recipes, demos, and hero apps all reference this directory — never duplicate code inline.
- **Recipe pages** (`site/recipes/*.md`) pull code via `<<< @/../examples/<name>.ts`.
- **Interactive demos** (`site/.vitepress/theme/components/examples/<Name>.vue`) import stores via `import { ... } from "@examples/<name>"`. Vue files handle UI only.
- See [docs/docs-guidance.md](docs/docs-guidance.md) for the full documentation tier system.

## Code style

- Biome: tabs, 100 char line width, `noExplicitAny: off`
- Completion signaling uses standard callbag END (type 2)
- Integer `_status` packed into `_flags` (bits 7-9) for V8 optimization; string exposed via getter
- **Testing:** Always use `Inspector.observe()` for test assertions, not raw callbag sinks — see [docs/test-guidance.md](docs/test-guidance.md)
