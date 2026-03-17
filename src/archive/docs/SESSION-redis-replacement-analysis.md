---
SESSION: redis-replacement-analysis
DATE: March 17, 2026
TOPIC: Redis Drop-in Replacement Strategy — Architecture, Data Structures, Performance Analysis
---

## KEY DISCUSSION

### What Redis Actually Is (5 Things Glued Together)

| Redis Capability | What it does | Our Answer |
|---|---|---|
| **Data structures** | String, Hash, List, Set, SortedSet, Stream, HyperLogLog, Bitmap, Geo | Reactive data structure primitives |
| **Key expiry (TTL)** | Every key has optional TTL, passive+active expiry | Already in kvStore |
| **Pub/Sub** | Publish messages to channels, subscribers get pushed | Native callbag — `producer()` + `effect()` |
| **Transactions** | MULTI/EXEC atomic command batches | `batch()` already does this |
| **Persistence** | RDB snapshots, AOF append-only log | `effect()` sink to any storage adapter |

### Where We Genuinely Beat Redis

| Dimension | Redis | Us |
|---|---|---|
| **Latency** | 50-500μs (TCP roundtrip) | 10ns (in-process) — **10,000x** |
| **Derived views** | Not possible — must recompute client-side | `derived()` caches, push-invalidates — O(1) reads |
| **Pub/Sub + state** | Separate systems (fire-forget, no state) | Unified — pub/sub IS the state graph |
| **Transactions** | MULTI/EXEC (optimistic locking, can fail) | `batch()` — guaranteed atomic |
| **Observability** | External monitoring | `Inspector` built-in, per-node |
| **Backpressure** | None (pub/sub drops if slow) | Callbag protocol built-in |
| **Cancellation** | Not possible | `switchMap`, `takeUntil` — first class |
| **Type safety** | None (everything bytes) | Full TypeScript generics |

### Where Redis Still Wins (Don't Compete)

- **Persistence/durability** — RDB+AOF. Solution: `effect()` adapters (Phase 5.5)
- **Cross-process/cross-machine** — Network service. Solution: bridge adapters (Phase 6)
- **Eviction policies** — 8 strategies. Solution: `evictionPolicy` utility (see SESSION-generic-utils-design)
- **Lua scripting** — Not needed; "server" IS your process
- **Cluster/replication** — Not applicable for in-process

### The Product Positioning

Per docs/state-management.md: **"not 'we replace Redis' but 'we're the reactive layer that makes Redis unnecessary for in-process state.'"**

The pitch: if your data lives in the same process as your logic — agent memory, session state, computed views, streaming accumulators, caches — you don't need a network hop. Reactive data structures give you the same functionality with 10,000x less latency, plus reactivity, derived views, and type safety that Redis can never have.

When you DO need persistence or cross-process, plug in an `effect()` adapter to Redis/Postgres — the graph topology stays identical.

### Benchmark Targets

| Operation | Redis | Our Target | Speedup |
|---|---|---|---|
| Point read | 100μs | 10ns | 10,000x |
| Point write | 100μs | 50ns | 2,000x |
| Vector search (k=10, 10K items) | 500μs | 5μs | 100x |
| Derived view read (cached) | N/A | 10ns | ∞ |
| Batch update (10 keys) | 1ms | 200ns | 5,000x |

---

## PART 2: FIRST-PRINCIPLES REDESIGN — Design for Modern Needs, Then Compat

### The Question

Should we copy Redis's 7 data structures (String, Hash, List, Set, SortedSet, Stream, Pub/Sub) or design for what modern apps actually need?

**Decision: Design for modern needs first. Redis compat is a thin mapping layer on top.**

Redis data structures were designed in 2009 for C with string-only values:
- Lists are doubly-linked because Redis needed O(1) push/pop at both ends
- Sorted sets are skip-list-backed with string members and float scores
- Sets are unordered bags of strings with set-algebra operations

### What Modern Apps Actually Need (Use-Case Analysis)

| Use case | What they store | Access pattern | What matters |
|---|---|---|---|
| **AI Agent Memory** | Facts, conversations, entities | Append, scored retrieval, tag filtering | Reactive scoring, decay, windowed views |
| **LLM Streaming App** | Token stream, message history, tool calls | Append + accumulate, windowed reads | Append log, reactive tail, cancellation |
| **Real-time Dashboard** | Time-series, aggregations, leaderboards | Windowed reads, sorted by score | Ring buffer, reactive sorted views |
| **Session Management** | Per-session data, presence | KV with TTL, lookup by key | TTL, namespace scoping, eviction |
| **Cache** | Computed results by key | Read-heavy, TTL, eviction on capacity | getOrSet, LRU/LFU, maxSize |
| **Config / Feature Flags** | Key-value pairs, rarely written | Write rarely, subscribe often | Per-key reactivity, batch init |
| **Counters / Metrics** | Numeric values | Atomic increment, aggregation | `update(key, fn)`, derived sums |

### Three Modern Primitives (Not Seven Redis Copies)

#### 1. `reactiveMap<V>()` — Redesigned kvStore

**What's wrong with current kvStore:**
- **Dual source of truth** — `_map` and `_stores` can diverge. `kv.store(key).set(val)` bypasses the pipeline (skips TTL, key tracking, eviction).
- **Per-key stores are writable** — breaks encapsulation, anyone can bypass set/delete.
- **No atomic update** — `set(key, transform(get(key)))` is two operations.
- **No cache-miss handler** — manual check+compute+set instead of `getOrSet`.
- **No eviction** — TTL only, no maxSize/LRU/LFU.
- **`select()` leaks** — new derived on every call, never cached.
- **`_syncKeys()` O(n)** — copies all keys on every mutation.

**Key insight: The Map is the source of truth. Reactive stores are read-only views, not entry points.**

**Redesigned interface:**

```ts
interface ReactiveMap<V> {
  // --- CRUD ---
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  delete(key: string): boolean;
  has(key: string): boolean;
  update(key: string, fn: (current: V | undefined) => V): void;  // atomic
  getOrSet(key: string, factory: () => V): V;                     // cache pattern

  // --- Bulk ---
  keys(): string[];
  values(): V[];
  entries(): [string, V][];
  size(): number;
  clear(): void;
  setMany(entries: Record<string, V> | [string, V][]): void;

  // --- Reactive (read-only views) ---
  select(key: string): Store<V | undefined>;     // cached, auto-cleaned on delete
  keysStore: Store<string[]>;                     // lazy, version-gated (not O(n) per mutation)
  sizeStore: Store<number>;
  where(pred: (v: V, k: string) => boolean): Store<[string, V][]>;  // reactive filtered view

  // --- TTL ---
  setWithTTL(key: string, value: V, ttlMs: number): void;
  ttl(key: string): number | undefined;           // remaining TTL
  persist(key: string): void;                     // remove TTL, keep key

  // --- Events ---
  events: Store<KVEvent<V>>;                      // keyspace notifications

  // --- Scoping ---
  namespace(prefix: string): ReactiveMap<V>;      // virtual partitioning

  // --- Lifecycle ---
  destroy(): void;
}
```

**What changed from kvStore:**

| Dropped | Why |
|---|---|
| `store(key): WritableStore` | Eliminated dual-state problem. `select()` is read-only. |
| Eager `_syncKeys()` | Replaced with version-gated lazy derivation. |

| Added | Why |
|---|---|
| `update(key, fn)` | Atomic read-modify-write. Replaces Redis HINCRBY with general-purpose. |
| `getOrSet(key, factory)` | The #1 cache pattern — one call instead of check+compute+set. |
| `where(pred)` | Reactive filtered view — impossible in Redis. |
| `namespace(prefix)` | Virtual scoping without data copying. Multi-tenant, session scoping. |
| `events` | Keyspace notifications as a reactive store. Zero cost if unsubscribed. |
| `ttl(key)` / `persist(key)` | TTL introspection and removal. |
| Pluggable eviction | Via utils layer — `maxSize` + `eviction: lru()`. |

**Internal architecture fix:**
- `_map: Map<string, V>` remains the source of truth
- `_internalStates: Map<string, WritableStore<V|undefined>>` are internal, never exposed
- `select(key)` returns a cached read-only derived from the internal state
- `set(key, val)` updates `_map` AND internal state atomically
- `delete(key)` tears down internal state + removes from cache
- `keysStore` uses `_version: state<number>` bumped on add/delete — array materialized lazily only when observed
- No divergence possible because there's only one write path

#### 2. `reactiveLog<T>()` — Not a Redis List

Redis List is a doubly-linked list with O(1) push/pop at both ends. Modern apps don't need a deque — they need an **append log with reactive windowed views**.

```ts
interface ReactiveLog<T> {
  append(item: T): void;
  clear(): void;

  entries: Store<T[]>;               // all items (reactive)
  tail(n: number): Store<T[]>;       // last N items (reactive derived)
  slice(start: number, end?: number): Store<T[]>;  // window view (reactive)
  size: Store<number>;

  destroy(): void;
}
```

Bounded: when length exceeds `maxSize`, oldest entries are dropped (FIFO — structural, no eviction policy needed).

**Why not "reactiveList"?** The dominant access pattern is append + read tail, not random insert/delete at both ends. Modern use cases:
- Chat message history → `append()` + `tail(50)`
- Activity feeds → `append()` + `tail(20)`
- Event logs → `append()` + `slice(offset, offset+pageSize)`
- Time-series → `append()` + bounded by `maxSize`

If someone needs a deque, they can use `state<T[]>()` directly.

#### 3. `reactiveIndex<K, V>()` — Not a Redis SortedSet

Redis SortedSet has static scores — you ZADD with a score, it stays until you ZADD again. If scores depend on time (recency decay), you must recompute and re-insert from the client.

Our reactive index: **the score function is a `derived()`. When metadata changes, the index position updates automatically.** This is architecturally impossible in Redis.

```ts
interface ReactiveIndex<K, V> {
  add(key: K, value: V): void;
  delete(key: K): boolean;
  get(key: K): V | undefined;
  has(key: K): boolean;

  topK(k: number): Store<[K, V][]>;               // reactive! auto-updates on score change
  range(minScore: number, maxScore: number): Store<[K, V][]>;  // reactive score range
  rank(key: K): Store<number>;                     // reactive rank
  size: Store<number>;

  destroy(): void;
}
```

Internally uses sorted array (small N) or skip list (large N). Reactive views (`topK`, `range`) are `derived()` stores.

#### 4. `pubsub()` — Channel-based reactive messaging

Thin layer — literally a `Map<string, producer()>`:

```ts
interface PubSub<T> {
  publish(channel: string, data: T): void;
  subscribe(channel: string): Store<T>;
  channels(): Store<string[]>;
  destroy(): void;
}
```

### Why NOT a Reactive Set?

Set algebra (SINTER, SUNION, SDIFF) is rare in modern apps. When it appears:
- "Set of items" → `state<Set<T>>()` with `.update()`
- "Items with tag X" → `collection.byTag('x')` or `derived()` + filter
- Set algebra → `derived([setA, setB], () => intersection(...))`

A dedicated `reactiveSet` would add API surface without adding capability that `derived()` over `state<Set>()` doesn't already provide.

### Redis Compat Layer (~100 lines of mapping)

```ts
redis.HSET(hash, field, val)  → map.set(field, val)
redis.HGET(hash, field)       → map.get(field)
redis.HDEL(hash, field)       → map.delete(field)
redis.HMSET(hash, ...)        → map.setMany(...)
redis.HGETALL(hash)           → map.entries()
redis.HINCRBY(hash, f, n)    → map.update(f, v => (v ?? 0) + n)
redis.HLEN(hash)              → map.size()
redis.HEXISTS(hash, f)        → map.has(f)
redis.HKEYS(hash)             → map.keys()
redis.LPUSH(list, val)        → log.append(val)
redis.LRANGE(list, 0, -1)     → log.entries.get()
redis.LRANGE(list, -n, -1)    → log.tail(n).get()
redis.ZADD(zset, score, mem)  → index.add(mem, val)
redis.ZRANGE(zset, 0, k)      → index.topK(k).get()
redis.ZRANGEBYSCORE(...)       → index.range(min, max).get()
redis.ZRANK(zset, mem)         → index.rank(mem).get()
redis.PUBLISH(ch, msg)         → ps.publish(ch, msg)
redis.SUBSCRIBE(ch)            → ps.subscribe(ch)
redis.MULTI/EXEC               → batch(() => { ... })
redis.EXPIRE(key, sec)         → map.setWithTTL(key, val, sec * 1000)
```

### Revised Build Order

1. **Generic utils** (backoff, evictionPolicy) — foundational
2. **`reactiveMap`** — redesigned kvStore, fixes dual-state, adds atomic update/getOrSet/eviction
3. **`reactiveLog`** — simplest new primitive, immediately useful for chat/agent
4. **`reactiveIndex`** — the "wow" factor, reactive score functions
5. **`pubsub`** — thin channel layer over callbag
6. **Redis compat layer** — thin command mapping (~100 lines)

---

## KEY INSIGHTS

1. **Design for modern needs first, Redis compat second.** Redis structures are 2009 C-era designs with string-only values. Copy the semantics that matter, redesign the rest.

2. **Three primitives, not seven.** `reactiveMap`, `reactiveLog`, `reactiveIndex` cover all modern use cases. `reactiveSet` is unnecessary — `derived()` over `state<Set>()` is more powerful.

3. **The Map is the source of truth, stores are derived views.** This eliminates the dual-state problem in kvStore and is the key architectural fix for reactiveMap.

4. **Reactive score functions are architecturally impossible in Redis.** `reactiveIndex` auto-re-sorts when metadata changes — no client-side recompute loop.

5. **`update(key, fn)` and `getOrSet(key, factory)` are the two primitives Redis never had.** Atomic read-modify-write and cache-miss handling in one call each.

## REJECTED ALTERNATIVES

- **Copy all 7 Redis structures** — rejected because most are 2009 design artifacts (doubly-linked list, set algebra, HyperLogLog). Modern apps don't need these.
- **Make kvStore's `store(key)` return a writable store** — rejected because it creates dual source of truth. Read-only `select()` is the fix.
- **Reactive Set as a separate primitive** — rejected because `derived()` over `state<Set>()` provides the same capability without new API surface.
- **Design for Redis API first** — rejected because it constrains the reactive model to fit string-only, non-reactive semantics. Compat layer is trivial.

## FILES CHANGED

- This file created and updated: `src/archive/docs/SESSION-redis-replacement-analysis.md`

---END SESSION---
