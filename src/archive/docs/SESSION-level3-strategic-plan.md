---
SESSION: level3-strategic-plan
DATE: March 17, 2026
TOPIC: Level 3 Strategic Plan — Data Structures + Orchestration (reactiveMap, reactiveLog, reactiveIndex, NodeV0, DAG scheduling)
---

## KEY DISCUSSION

### The Four-Level Architecture

User defined a progressive, opt-in architecture where each level imports only what it needs:

| Level | What | Import |
|---|---|---|
| **Level 1** | 5 primitives (state, derived, producer, operator, effect) + plain JS values | `callbag-recharge/core` |
| **Level 2** | Core + extras (operators, sinks, sources) — frontend + backend state management | `callbag-recharge`, `/extra` |
| **Level 3** | Data structures + NodeV0 + orchestration (redis-like + airflow-like) | `callbag-recharge/data`, `/memory`, `/orchestrate` |
| **Level 4** | Complete data persistence + NodeV1/V2 + in-process / in-network / offline ("almighty") | `callbag-recharge/persist`, `/sync`, `/caps` |

**Key principle:** Level 3 pays for nothing it doesn't use. No CID hashing, CBOR encoding, or capability tokens unless you import Level 4.

### How the Three Research Documents Map

**Universal Data Structure Research → splits across levels:**
- `id` + `version` → Level 3 (NodeV0, cheap, always-on for data structures)
- `cid` + `prev` + `schema` → Level 4 (NodeV1, opt-in, lazy computation)
- `caps` + `refs` + encoding → Level 4 (NodeV2, opt-in modules)

**Redis Replacement Analysis → Level 3:**
- `reactiveMap`, `reactiveLog`, `reactiveIndex` — all Level 3
- Hot-path performance (10ns reads) preserved because CID is Level 4, not Level 3
- NodeV0 overhead is just two fields (`id: string`, `version: number`) — negligible

**Agentic Memory Research → Level 3:**
- `memoryNode`, `collection`, `decay` — Level 3 (built on data structures)
- Agent memory as the P0 application — reactive scoring, push-based dirty tracking
- Orchestration patterns (DAG scheduling, cron triggers) — Level 3

### The Critical Boundary: Level 3 vs Level 4

Level 3 data structures use NodeV0 internally — fast, no hashing. Level 4 wraps them with content addressing on demand:

```ts
// Level 3: fast, no CID overhead
const cache = reactiveMap<string, User>();
cache.set("u1", alice);        // 10ns target ✓

// Level 4: opt-in, lazy CID
import { withContentAddress } from "callbag-recharge/persist";
const verifiable = withContentAddress(cache);
verifiable.cid;                // computed on access, not on set()
```

### Level 3 Build Order

| Step | What | Why First | Effort |
|---|---|---|---|
| 1 | `reactiveMap` | Fixes kvStore bugs, foundation for everything | 2-3 days |
| 2 | `reactiveLog` | Simplest new primitive, immediately useful | 1 day |
| 3 | `reactiveIndex` | The wow factor, enables reactive memory | 2-3 days |
| 4 | Refactor `collection` to use `reactiveIndex` internally | Unifies scoring | 1 day |
| 5 | NodeV0 (`store.snapshot()` / `state.from()`) | Serialization without breaking anything | 1-2 days |
| 6 | `pubsub` | Thin, ~30 lines | half day |
| 7 | `fromCron` + `taskState` + `dag` | Enables personal airflow use case | 1 day |

### Module Structure

```
callbag-recharge/
├── src/core/          # Level 1 — 5 primitives
├── src/extra/         # Level 2 — operators
├── src/data/          # Level 3A-C — data structures
│   ├── reactiveMap.ts
│   ├── reactiveLog.ts
│   ├── reactiveIndex.ts
│   ├── pubsub.ts
│   └── index.ts
├── src/memory/        # Level 3 — agent memory (built ON data/)
│   ├── node.ts
│   ├── collection.ts
│   ├── decay.ts
│   └── index.ts
├── src/orchestrate/   # Level 3E — DAG/scheduling
│   ├── fromCron.ts
│   ├── taskState.ts
│   └── index.ts
└── src/persist/       # Level 4 (future)
```

### reactiveMap Design (Replacing kvStore)

**Key fixes over kvStore:**
1. Single source of truth — `_map` only, stores are read-only views
2. `select()` cached and auto-cleaned on delete (no leaks)
3. `update(key, fn)` — atomic read-modify-write
4. `getOrSet(key, factory)` — cache-miss handler
5. `where(pred)` — reactive filtered view
6. `namespace(prefix)` — virtual scoping
7. `events` store — keyspace notifications (lazy, zero-cost if unobserved)
8. Version-gated `keysStore` (not O(n) `_syncKeys()`)
9. Pluggable eviction via opts

### Orchestration = Existing Primitives + Scheduling

The DAG executor is NOT new code — `derived()` + `effect()` with explicit deps IS the DAG executor (diamond resolution). What's new:
1. `fromCron(schedule)` — producer with built-in zero-dependency cron parser
2. `taskState()` — state store with run metadata (lastRun, status, error, duration)
3. `dag(tasks)` — optional sugar for acyclicity validation (Kahn's algorithm) + Inspector graph view

### The Airflow-in-TypeScript Example

```ts
const daily = fromCron('0 9 * * *');
const fetchBank = pipe(daily, exhaustMap(() => fromPromise(plaid.sync())), retry(3));
const fetchCards = pipe(daily, exhaustMap(() => fromPromise(stripe.charges())), retry(3));
const aggregate = derived([fetchBank, fetchCards], (bank, cards) => merge(bank, cards));
const alerts = pipe(aggregate, filter(txns => txns.some(t => t.amount > 500)));
effect([alerts], txns => telegram.send(format(txns)));
```

---

## REJECTED ALTERNATIVES

- **Eager CID on every set()** — rejected because it blows the 10ns write target by 10-100x. CID is lazy, Level 4 only.
- **UniversalNode as mandatory base** — rejected because most users don't need content addressing. NodeV0 is the Level 3 minimum.
- **Build Kafka/job queue** — rejected because callbag primitives replace in-process message passing entirely. External queues are Level 4+ for cross-machine durability.
- **Copy all 7 Redis structures** — rejected because most are 2009 design artifacts.

## KEY INSIGHTS

1. **Performance and completeness are not in conflict if the heavy parts are pluggable.** Level 3 gets 10ns reads. Level 4 adds CID/caps on demand.

2. **The boundary between Level 3 and Level 4 is the performance firewall.** NodeV0 (id + version) is negligible overhead. NodeV1 (CID + prev) is opt-in computation.

3. **Diamond resolution IS a DAG executor.** No new scheduling engine needed — `derived()` with explicit deps already guarantees correct ordering.

4. **Three data primitives (map, log, index) cover all modern use cases** that Redis's seven structures were designed for, plus reactive capabilities Redis can never have.

## IMPLEMENTATION: reactiveMap (Step 1 Complete)

### What Was Built

`src/data/reactiveMap.ts` — replaces `src/memory/kv.ts` (kvStore).

**Architectural fix: single source of truth.** kvStore had a dual-state bug where `store(key).set(val)` bypassed the pipeline (skipped TTL, key tracking, eviction). reactiveMap eliminates this: `_states` are internal only, `select()` returns read-only derived stores. There is exactly one write path.

**Key implementation decisions:**

1. **Version-gated keysStore.** Instead of kvStore's `_syncKeys()` which copied all keys O(n) on every mutation, reactiveMap uses `_version: state<number>` bumped only on key add/delete. `keysStore` is `derived([_version], () => Array.from(_map.keys()))` — materializes lazily only when observed.

2. **Undefined-safe equals wrapper.** User-provided `equals` (e.g., `(a, b) => a.x === b.x`) crashes when comparing `undefined` with a value. Internal `_undefinedSafeEquals` guards: if either arg is undefined, fall back to `===`.

3. **FIFO eviction via `_insertOrder`.** Simple array tracking insertion order. When `maxSize` exceeded, oldest keys are deleted first. Overwrites don't trigger eviction (not a new key).

4. **Namespace as thin proxy.** `namespace(prefix)` returns a `ReactiveMap<V>` that prefixes all keys. No data copying — delegates to parent. Nestable: `m.namespace("a:").namespace("b:")` → keys prefixed with `"a:b:"`. Namespace `destroy()` only clears scoped keys, not the parent.

5. **Events as lazy state.** `_events = state<KVEvent | undefined>(undefined, { equals: () => false })`. Always emits (events are ephemeral). Zero cost if nobody subscribes (callbag lazy start).

6. **Select caching.** `select(key)` caches the derived store per key in `_selects` Map. Same key returns same store object.

### Files Changed

| File | Action |
|---|---|
| `src/data/reactiveMap.ts` | Created — 400 lines |
| `src/data/types.ts` | Created — ReactiveMap, ReactiveMapOptions, KVEvent types |
| `src/data/index.ts` | Created — module entry point |
| `src/__tests__/data/reactiveMap.test.ts` | Created — 35 tests covering CRUD, atomic ops, reactive API, events, batch, TTL, namespace, eviction, lifecycle, custom equals |
| `src/memory/kv.ts` | Removed → TRASH/ (replaced by reactiveMap) |
| `src/__tests__/memory/kv.test.ts` | Removed → TRASH/ (replaced by reactiveMap tests) |
| `src/memory/types.ts` | Cleaned — removed KVStore/KVStoreOptions types |
| `src/memory/index.ts` | Cleaned — removed kvStore export |
| `tsup.config.ts` | Added `src/data/index.ts` entry point |
| `src/archive/docs/DESIGN-ARCHIVE-INDEX.md` | Updated with this session |

### Test Results

33 test files, 1068 tests passing. reactiveMap test suite:

- Basic CRUD (get/set/has/delete/keys/values/entries/size/clear/overwrite)
- Atomic operations (update, getOrSet with and without existing key)
- Reactive API (select read-only, select caching, keysStore, sizeStore, where)
- Events (set/delete/clear keyspace notifications)
- Batch (setMany atomicity with record and tuple inputs)
- TTL (expiry, defaultTTL, override, delete clears timer, ttl() introspection, persist())
- Namespace (scoped CRUD, clear scoped only, nested, reactive select)
- Eviction (FIFO maxSize, overwrite doesn't evict)
- Lifecycle (destroy prevents writes, clears timers)
- Custom equals (dedup with undefined safety)

### What's Next (Level 3 Remaining Steps)

| Step | What | Status |
|---|---|---|
| 1 | reactiveMap | **Done** |
| 2 | reactiveLog | **Done** |
| 3 | reactiveIndex | **Done** |
| 4 | Refactor collection to use reactiveIndex | **Done** |
| 5 | NodeV0 (store.snapshot() / state.from()) | **Done** |
| 6 | pubsub | **Done** |
| 7 | fromCron + taskState | **Done** |

## OPTIMIZATION PASS (March 17, 2026)

Applied three optimizations after benchmark comparison with Preact Signals:

### 1. Integer `_status` packed into `_flags` (core)
Replaced string `_status` property with 3-bit integer in `_flags` bits 7-9 across ProducerImpl, StateImpl, DerivedImpl, OperatorImpl. String exposed via getter for backward compat. **Diamond pattern gap improved ~6.8x → 3.8x.**

### 2. Bounded reactiveLog circular buffer
Replaced O(n) `splice(0, overflow)` with real circular buffer (fixed array + head/write index). **Gap improved ~10.8x → 2.54x.**

### 3. Version-gated collection stores
Replaced `state<MemoryNode[]>` with version counter + lazy `derived()` materialization. Simplified node ID generation (removed `Date.now()`). **Collection gap improved ~41.6x → 29.4x.**

### Level 3 Benchmark Results (post-optimization, Vitest/tinybench)

| Benchmark | vs Native/Baseline | Notes |
|---|---|---|
| reactiveMap vs Map (set+get) | 1.56x | Good — 64% of native speed |
| reactiveMap.update vs Map RMW | 2.00x | Acceptable — reactive overhead |
| reactiveMap select vs Map.get | 1.76x | Good |
| reactiveLog.append vs array push | 2.51x | Good — includes version+event overhead |
| **bounded reactiveLog vs ring buffer** | **2.54x** | Fixed from 10.8x via circular buffer |
| reactiveIndex vs hand-rolled | 1.26x | Excellent |
| reactiveIndex.select vs Map.get | 1.01x | Effectively native speed |
| **collection x50 + byTag** | **29.4x** | Bottleneck: per-node reactive stores + reactiveScored (19.6x) |
| reactiveScored evict+reinsert | 19.6x | Primary collection bottleneck |
| lru vs naive array+Set | 1.78x | |
| fifo vs array queue | 1.02x | Effectively native speed |

**Key insight:** Level 3 data structures (reactiveMap, reactiveLog, reactiveIndex) are all within 1-2.5x of native — excellent. The remaining gap is in `collection` which stacks multiple reactive primitives per node. The `reactiveScored` eviction policy (heap-backed, reactive subscription per node) is the dominant cost. For use cases not needing reactive eviction, raw reactiveIndex + reactiveMap are near-native.

## FILES CHANGED

- This file created: `src/archive/docs/SESSION-level3-strategic-plan.md`
- `src/archive/docs/DESIGN-ARCHIVE-INDEX.md` updated
- `src/data/reactiveMap.ts` created
- `src/data/types.ts` created
- `src/data/index.ts` created
- `src/__tests__/data/reactiveMap.test.ts` created
- `src/memory/kv.ts` removed (→ TRASH/)
- `src/__tests__/memory/kv.test.ts` removed (→ TRASH/)
- `src/memory/types.ts` cleaned (removed KVStore types)
- `src/memory/index.ts` cleaned (removed kvStore export)
- `tsup.config.ts` updated

---END SESSION---
