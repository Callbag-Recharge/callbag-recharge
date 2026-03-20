# Utils

Pure utilities and reactive building blocks. Usable standalone or as foundations for operators, data structures, and patterns.

Exported from `callbag-recharge/utils`.

## Available Utilities

| Utility | File | Description |
|---------|------|-------------|
| **Backoff Strategies** | `backoff.ts` | Pure delay functions: `constant`, `linear`, `exponential`, `fibonacci`, `decorrelatedJitter`. Plus `withMaxAttempts` decorator. |
| **Batch Writer** | `batchWriter.ts` | Accumulate items, flush on count or time threshold. Reactive `size`, `totalFlushed`, `flushing` stores. |
| **Cancellable Action** | `cancellableAction.ts` | Async action with auto-cancel-previous, reactive loading/error/data state, optional rate limiting. |
| **Cancellable Stream** | `cancellableStream.ts` | Async stream with AbortSignal + auto-cancel-previous. `fromAbortable()` for one-shot streams. |
| **Circuit Breaker** | `circuitBreaker.ts` | Three-state failure isolation (CLOSED → OPEN → HALF_OPEN). Composes with `BackoffStrategy` for cooldown. |
| **Connection Health** | `connectionHealth.ts` | Heartbeat + auto-reconnect monitor. Uses backoff for reconnect delays. Reactive status/healthy/reconnectCount. |
| **Eviction Policies** | `eviction.ts` | Key-tracking policies: `fifo`, `lru`, `lfu`, `scored`, `random`. Implements `EvictionPolicy<K>`. |
| **Rate Limiter** | `rateLimiter.ts` | `tokenBucket()` (steady-rate + burst) and `slidingWindow()` (count over time). Cross-stream rate limiting. |
| **Reactive Eviction** | `reactiveEviction.ts` | `reactiveScored()` — O(log n) min-heap backed by reactive score stores. |
| **State Machine** | `stateMachine.ts` | Finite state machine with typed states/events. Reactive `current`/`context` stores, `onEnter`/`onExit` hooks. |

## Design Principles

1. **Strategies, not patterns.** These are reusable building blocks that configure behavior. Patterns compose them into opinionated recipes.
2. **Core + extra only.** Utils import from `core/` and `extra/` only (never from `data/`, `memory/`, or `orchestrate/`). Compose with existing operators (e.g. `switchMap`, `subscribe`) instead of reimplementing callbag wiring.
3. **Every utility has 3+ consumers.** If it's only used in one place, it should be inlined there instead.
4. **Composition over configuration.** Circuit breaker uses backoff. Rate limiters plug into cancellableAction. State machine composes with any store.

## Dependency Graph

```
backoff ──────────┬──► retry (enhanced: delay between re-subscriptions)
                  ├──► circuitBreaker (cooldown escalation)
                  ├──► connectionHealth (reconnect delays)
                  └──► producer reconnect (future: WebSocket/SSE)

evictionPolicy ───┬──► reactiveMap (bounded: maxSize option)
                  ├──► collection (scored: decay-based memory eviction)
                  └──► future patterns (lruCache, sessionStore)

circuitBreaker ───┬──► connectionHealth (failure isolation)
                  ├──► producer (external API sources)
                  └──► future adapters

rateLimiter ──────┬──► cancellableAction (API call throttling)
                  ├──► chatStream (LLM API rate limits)
                  └──► rateLimiter pattern (reactive operator)

cancellableAction ┬──► pagination (page fetching)
                  ├──► formField (async validation)
                  └──► any async action with auto-cancel

cancellableStream ┬──► chatStream (LLM streaming)
                  ├──► SSE event sources
                  └──► any async iterable with AbortSignal

stateMachine ─────┬──► UI state management
                  ├──► workflow orchestration
                  └──► protocol handlers

batchWriter ──────┬──► write-behind caching
                  ├──► log aggregation
                  └──► API batch endpoints

connectionHealth ─┬──► WebSocket monitoring
                  ├──► database connection pools
                  └──► microservice health checks
```
