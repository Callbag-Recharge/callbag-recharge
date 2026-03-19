# Patterns

Composed recipes built on callbag-recharge's core primitives (`state`, `derived`, `effect`, `producer`, `operator`), extras, and utils. Each pattern is a self-contained module in its own subfolder with documentation, implementation, and tests.

## Available Patterns

| Pattern | Import | Description |
|---------|--------|-------------|
| [createStore](./createStore/) | `callbag-recharge/patterns/createStore` | Zustand-style single-store with state + actions. Diamond-safe `select()` selectors, Zustand StoreApi compat. |
| [chatStream](./chatStream/) | `callbag-recharge/patterns/chatStream` | LLM streaming chat with message history, partial response tracking, stop/retry, rate limiting, system prompts. |
| [memoryStore](./memoryStore/) | `callbag-recharge/patterns/memoryStore` | Three-tier AI memory: session (ephemeral), working (bounded FIFO), long-term (decay-scored). Cross-tier recall, promotion, tag-based search. |
| [rateLimiter](./rateLimiter/) | `callbag-recharge/patterns/rateLimiter` | Reactive rate-limiting operator. Wraps a source with configurable strategy: `drop`, `queue`, or `error`. |
| [undoRedo](./undoRedo/) | `callbag-recharge/patterns/undoRedo` | State with undo/redo history. Reactive `canUndo`/`canRedo` stores, `maxHistory` cap, equality dedup. |
| [pagination](./pagination/) | `callbag-recharge/patterns/pagination` | Paginated data fetching with reactive state. Auto-cancel on page change, `hasNext`/`hasPrev`, `next`/`prev`/`goTo`. |
| [formField](./formField/) | `callbag-recharge/patterns/formField` | Form field with sync + async validation. Reactive `value`/`error`/`dirty`/`touched`/`valid`/`validating` stores. |

## How Patterns Differ from Core, Extras, and Utils

- **Core** (`callbag-recharge`) — The five primitives: `state`, `derived`, `effect`, `producer`, `operator`. Minimal, protocol-level building blocks.
- **Extras** (`callbag-recharge/extra`) — Operators and sources (map, filter, switchMap, debounce, etc.). Single-purpose, composable via `pipe()`.
- **Utils** (`callbag-recharge/utils`) — Reusable building blocks: backoff, circuit breaker, rate limiter, cancellable action/stream, state machine, batch writer, connection health. Can be used standalone or by patterns.
- **Patterns** (`callbag-recharge/patterns/<name>`) — Opinionated, higher-level recipes that compose core + extras + utils into ready-to-use solutions for common use cases.

## Creating a New Pattern

Each pattern lives in its own subfolder:

```
src/patterns/
  README.md              ← this file (index of all patterns)
  createStore/
    index.ts             ← implementation
    README.md            ← usage docs, API reference, migration guide
  chatStream/
    index.ts
  memoryStore/
    index.ts
  rateLimiter/
    index.ts
  undoRedo/
    index.ts
  pagination/
    index.ts
  formField/
    index.ts
```

Tests go in the corresponding test directory:

```
src/__tests__/patterns/
  createStore/
    index.test.ts
  chatStream/
    index.test.ts
  memoryStore/
    index.test.ts
  rateLimiter/
    index.test.ts
  undoRedo/
    index.test.ts
  pagination/
    index.test.ts
  formField/
    index.test.ts
```

To make a pattern importable, add entries to:
1. `tsup.config.ts` — add `"src/patterns/<name>/index.ts"` to the entry array
2. `package.json` — add `"./patterns/<name>"` to the exports map
