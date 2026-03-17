# Patterns

Composed recipes built on callbag-recharge's core primitives (`state`, `derived`, `effect`, `producer`, `operator`) and extras. Each pattern is a self-contained module in its own subfolder with documentation, implementation, and tests.

## Available Patterns

| Pattern | Import | Description |
|---------|--------|-------------|
| [createStore](./createStore/) | `callbag-recharge/patterns/createStore` | Zustand-style single-store with state + actions. Diamond-safe `select()` selectors, Zustand StoreApi compat, full reactive graph composability. |

## How Patterns Differ from Core and Extras

- **Core** (`callbag-recharge`) — The five primitives: `state`, `derived`, `effect`, `producer`, `operator`. Minimal, protocol-level building blocks.
- **Extras** (`callbag-recharge/extra`) — Operators and sources (map, filter, switchMap, debounce, etc.). Single-purpose, composable via `pipe()`.
- **Patterns** (`callbag-recharge/patterns/<name>`) — Opinionated, higher-level recipes that compose core + extras into ready-to-use solutions for common use cases. Each pattern targets a specific developer audience or problem domain.

## Creating a New Pattern

Each pattern lives in its own subfolder:

```
src/patterns/
  README.md              ← this file (index of all patterns)
  createStore/
    index.ts             ← implementation
    README.md            ← usage docs, API reference, migration guide
  memoryStore/           ← (planned) AI/LLM memory management
    index.ts
    README.md
  ...
```

Tests go in the corresponding test directory:

```
src/__tests__/patterns/
  createStore/
    index.test.ts
  memoryStore/
    index.test.ts
```

To make a pattern importable, add entries to:
1. `tsup.config.ts` — add `"src/patterns/<name>/index.ts"` to the entry array
2. `package.json` — add `"./patterns/<name>"` to the exports map

## Planned Patterns

| Pattern | Target Audience | Status |
|---------|----------------|--------|
| `createStore` | Zustand/Redux single-store users | Available |
| `memoryStore` | AI/LLM applications (session + working + long-term memory) | Planned |
| `cancellableAction` | Async action management with auto-cancellation | Planned |
| `rateLimiter` | API rate limiting and request throttling | Planned |
| `chatStream` | LLM streaming chat with backpressure | Planned |
