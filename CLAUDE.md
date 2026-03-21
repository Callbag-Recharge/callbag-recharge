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
- **Benchmarks:** `pnpm run bench` (Vitest + tinybench). Focused: `bench:core`, `bench:compare`, `bench:data`
- **Bundle size:** `pnpm run size`

## Architecture

callbag-recharge is a reactive state management library where **every store is a callbag source**. The callbag protocol (START=0, DATA=1, END=2) is the internal wiring; users interact through a simple `Store` interface (`get()`, `set()`, `source()`).

**6 core primitives:** `producer`, `state`, `derived`, `dynamicDerived`, `operator`, `effect`. See [docs/architecture.md](docs/architecture.md) for the full design (protocol, signal handling, lifecycle, diamond resolution, output slot model, error handling, optimizations).

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

## Code style

- Biome: tabs, 100 char line width, `noExplicitAny: off`
- Completion signaling uses standard callbag END (type 2)
- Integer `_status` packed into `_flags` (bits 7-9) for V8 optimization; string exposed via getter
