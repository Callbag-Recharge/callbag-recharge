---
SESSION: generic-utils-design
DATE: March 17, 2026
TOPIC: Generic Utility Layer Design — Backoff, Eviction, Circuit Breaker, Rate Limiter
---

## KEY DISCUSSION

### Problem

There is a missing layer between extras (single operators) and patterns (composed recipes). Operators like `retry` have hardcoded behavior (instant retry, fixed count). Patterns like `kvStore` and `collection` inline their own eviction logic. These behaviors are **strategies** — pure functions or small objects that configure behavior rather than create reactive nodes. They need to be extracted into reusable utilities.

### Proposed Layer: `src/utils/`

Exported from `callbag-recharge/utils`. Pure utilities, zero reactive dependencies, usable standalone. Patterns and enhanced operators import from them.

---

### Utility 1: Backoff Strategies

**Interface:**
```ts
type BackoffStrategy = (attempt: number, error?: unknown) => number | null;
// Returns ms to wait, or null to stop retrying
```

**Built-in strategies:**
- `constant(ms)` — always same delay. Simple polling, health checks.
- `linear(base, step)` — `base + step * attempt`. Gentle ramp-up.
- `exponential(opts)` — `base * factor^attempt`, capped at `maxDelay`, with jitter. API rate limits, WebSocket reconnect, LLM API calls.
- `fibonacci(base)` — fib sequence × base. Gentler than exponential.
- `decorrelatedJitter(base, max)` — `random(base, min(max, lastDelay * 3))`. AWS-recommended for high-contention scenarios.

**Jitter is critical** — without jitter, N clients hitting a rate limit all retry simultaneously (thundering herd). Three jitter modes:
- Full jitter: `random(0, calculated)` — best for contention reduction
- Equal jitter: `calculated/2 + random(0, calculated/2)` — balanced
- Decorrelated jitter: `random(base, lastDelay * 3)` — AWS recommendation

**Consumers across the ecosystem:**
- `retry` operator (enhanced) — delay between re-subscriptions
- `producer()` reconnect — WebSocket/SSE auto-reconnect
- `effect()` write-behind — retry failed persistence writes
- `circuitBreaker` cooldown — period before half-open
- Future `fromWebSocket` source — reconnect on close/error
- Future API adapter — handle 429/503

**Enhancement to existing `retry`:**
```ts
// Before (current):
retry(3)   // instant retry, 3 times

// After (enhanced, backward-compatible):
retry({ count: 5, delay: exponential({ base: 100, factor: 2, maxDelay: 30_000, jitter: 'full' }) })
retry({ count: 3, delay: constant(1000) })
retry({ delay: exponential(), while: (err) => err.status === 429 })
```

---

### Utility 2: Eviction Policies

**Interface:**
```ts
interface EvictionPolicy<K> {
  touch(key: K): void;       // Record an access
  insert(key: K): void;      // Record an insertion
  delete(key: K): void;      // Record a deletion
  evict(count?: number): K[]; // Return key(s) to evict
}
```

Pure bookkeeping — doesn't hold values, just tracks access patterns and decides eviction order.

**Built-in policies:**
- `lru()` — Doubly-linked list + Map, O(1) for all operations. Default for most caches.
- `lfu()` — Frequency buckets with min-freq pointer, O(1). Hot-key caching.
- `ttl()` — Min-heap by expiry time. Session stores.
- `scored(fn)` — Custom score function, lazy sort on evict. Memory nodes (what collection does now).
- `fifo()` — Queue. Simple bounded buffers.
- `random()` — Random selection. Redis's `allkeys-random`.

**LRU implementation detail:**
- Doubly-linked list for ordering (move-to-front on access)
- Map<K, Node> for O(1) lookup
- Evict from tail
- ~50 lines, critical for performance

**Consumers:**
- `kvStore` (bounded) — LRU, TTL, LFU
- `collection` (memory nodes) — scored (decay-based)
- Future `lruCache` pattern
- Future `sessionStore` pattern
- Buffer operators (overflow handling)

**Composability:** Policies can compose — Redis's `volatile-lru` = "LRU but only among keys with TTL." Interface supports this naturally.

---

### Utility 3: Circuit Breaker

Three states: CLOSED → OPEN → HALF_OPEN → CLOSED/OPEN

```ts
interface CircuitBreaker {
  canExecute(): boolean;
  recordSuccess(): void;
  recordFailure(error?: unknown): void;
  state: 'closed' | 'open' | 'half-open';
}
```

Options: `failureThreshold` (default 5), `cooldownMs` (default 30s, uses backoff!), `halfOpenMax`.

**Consumers:**
- `producer()` connecting to external APIs
- `effect()` persistence adapters
- Future `fromWebSocket` — don't reconnect-loop on a permanently dead server

**Key design point:** Cooldown uses a BackoffStrategy — circuit breaker composes with backoff.

---

### Utility 4: Rate Limiter (Token Bucket)

Different from `throttle`/`debounce` — those are per-stream. Token bucket is shared, cross-stream.

```ts
interface RateLimiter {
  tryAcquire(): boolean;        // Non-blocking check
  acquire(): Promise<number>;   // Wait if needed, return ms waited
  available(): number;          // Current tokens
}
```

Token bucket: refills at `rate` tokens/second, max `burst` tokens.
Sliding window: timestamps of recent calls, reject if window full.

**Consumers:**
- LLM API calls (OpenAI/Anthropic RPM/TPM limits)
- `producer()` that fetches
- `effect()` that writes
- Pub/sub publish rate

---

### Dependency Graph

```
backoff ──────────┬──► retry (enhanced)
                  ├──► circuitBreaker
                  └──► producer reconnect

evictionPolicy ───┬──► kvStore (bounded)
                  ├──► collection
                  ├──► reactiveList (bounded)
                  ├──► reactiveSortedSet (bounded)
                  └──► future lruCache pattern

circuitBreaker ───┬──► producer (external sources)
   (uses backoff) ├──► effect (persistence)
                  └──► future adapters

rateLimiter ──────┬──► effect (API calls)
                  ├──► producer (fetch sources)
                  └──► future rateLimit operator
```

### Build Order

1. `backoff` — zero deps, immediately useful, unlocks enhanced retry
2. `evictionPolicy` (LRU first) — unlocks bounded kvStore and collection
3. `rateLimiter` (token bucket) — unlocks LLM API patterns
4. `circuitBreaker` — depends on backoff, unlocks resilient producers

---

## KEY INSIGHTS

1. **Strategies are not nodes.** They're pure functions/objects that configure behavior. They belong in `src/utils/`, not `src/core/` or `src/extra/`.

2. **Composition over configuration.** Circuit breaker uses backoff. Eviction policies compose (volatile-lru = filter + lru). Rate limiter + backoff = graceful degradation.

3. **Every utility has 3+ consumers.** If it's only used in one place, inline it. These all have broad use across patterns, operators, and future adapters.

4. **Backoff is the foundation.** Both circuit breaker and enhanced retry depend on it. Build it first.

## FILES CHANGED

- This file created: `src/archive/docs/SESSION-generic-utils-design.md`

---END SESSION---
