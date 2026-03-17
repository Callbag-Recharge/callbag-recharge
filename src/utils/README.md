# Utils

Pure utilities with zero reactive dependencies. Usable standalone or as building blocks for reactive operators, data structures, and patterns.

Exported from `callbag-recharge/utils`.

## Available Utilities

| Utility | File | Description |
|---------|------|-------------|
| **Eviction Policies** | `eviction.ts` | Pure key-tracking policies for bounded data structures: `fifo`, `lru`, `lfu`, `scored`, `random`. Implements `EvictionPolicy<K>` interface. |
| **Reactive Eviction** | `reactiveEviction.ts` | `reactiveScored()` — O(log n) min-heap backed by reactive score stores. Subscribes to score changes via `effect()`, auto-sifts on updates. |
| **Backoff Strategies** | `backoff.ts` | Pure delay functions for retry, reconnect, circuit breaker: `constant`, `linear`, `exponential`, `fibonacci`, `decorrelatedJitter`. Plus `withMaxAttempts` decorator. |

## Design Principles

1. **Strategies, not nodes.** These are pure functions/objects that configure behavior. They belong here, not in `core/` or `extra/`.
2. **Zero reactive imports** (except `reactiveEviction.ts` which bridges into the reactive graph).
3. **Every utility has 3+ consumers.** If it's only used in one place, it should be inlined there instead.
4. **Composition over configuration.** Policies compose (e.g., `withMaxAttempts` wraps any `BackoffStrategy`). Eviction policies can be plugged into any bounded data structure.

## Dependency Graph

```
backoff ──────────┬──► retry (enhanced: delay between re-subscriptions)
                  ├──► circuitBreaker (future: cooldown period)
                  └──► producer reconnect (future: WebSocket/SSE)

evictionPolicy ───┬──► reactiveMap (bounded: maxSize option)
                  ├──► collection (scored: decay-based memory eviction)
                  └──► future patterns (lruCache, sessionStore)

reactiveScored ───┬──► collection (reactive min-heap for memory nodes)
```
