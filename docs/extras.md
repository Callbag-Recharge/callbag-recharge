# Extra Modules

callbag-recharge ships extra sources, operators, and sinks as tree-shakeable entry points under `callbag-recharge/extra` or `callbag-recharge/extra/<name>`.

## Current extras

### Sources

| Module | Description |
|--------|-------------|
| `interval(ms)` | Emits incrementing integers at a fixed interval |
| `fromEvent(target, name)` | Wraps DOM/EventEmitter events as a source |
| `fromPromise(promise)` | Converts a Promise into a single-value source |
| `fromObs(observable)` | Converts an Observable (RxJS-compatible) into a source |
| `fromIter(iterable)` | Converts a sync iterable into a source |
| `fromAsyncIter(iterableOrFactory)` | Converts an AsyncIterable into a source; factory form `() => AsyncIterable` supports retry/repeat |
| `of(...values)` | Synchronously emits each provided value, then completes |
| `empty()` | Completes immediately without emitting any values |
| `throwError(err)` | Errors immediately with the given value |
| `never()` | Never emits, errors, or completes |

### Tier 1 operators (participate in diamond resolution, forward type 3)

| Module | Description |
|--------|-------------|
| `map(fn)` | Transforms each value |
| `filter(pred)` | Passes values matching a predicate; sends RESOLVED when suppressing |
| `scan(reducer, seed)` | Accumulates values with a reducer |
| `take(n)` | Emits only the first _n_ values, then disconnects + completes |
| `first` | Emits only the first value then completes (like `take(1)` but semantic) |
| `last` | Emits only the final value when upstream completes |
| `find(pred)` | First value matching predicate, then completes |
| `elementAt(n)` | Emits the _n_-th value (0-based) then completes |
| `partition(pred)` | Splits into two stores `[matching, notMatching]`; shares upstream |
| `skip(n)` | Skips the first _n_ values; sends RESOLVED when suppressing |
| `tap(fn)` | Side-effect passthrough; forwards all signals and values unchanged |
| `distinctUntilChanged(eq?)` | Suppresses consecutive duplicates; sends RESOLVED on duplicate |
| `pairwise` | Emits `[prev, curr]` pairs on each upstream change |
| `startWith(value)` | Returns `value` when upstream is `undefined`; switches to upstream once it emits |
| `takeUntil(notifier)` | Passes through values until notifier emits, then completes and tears down upstream |
| `takeWhile(pred)` | Emits values while predicate returns true, then disconnects upstream and completes. Failing value is **not** emitted. |
| `remember` | Caches the last upstream value and replays it to new subscribers |
| `merge(...sources)` | Merges multiple sources into one |
| `combine(...sources)` | Emits arrays of latest values when any source updates |
| `concat(...sources)` | Subscribes to sources sequentially |
| `flat` | Flattens a source of sources (mergeAll semantics) |
| `share` | Shares a single upstream subscription across multiple sinks |
| `buffer(notifier)` | Accumulates values into arrays; flushes on notifier emission |
| `withLatestFrom(...others, fn)` | When source emits, grabs current values from others; primary+secondary dep pattern (see architecture §4) |
| `subject` | Multicast primitive; both a source and manual emitter |

### Tier 2 operators (cycle boundaries, built on core primitives)

| Module | Description |
|--------|-------------|
| `debounce(ms)` | Delays propagation by `ms` ms; resets timer on each new value |
| `throttle(ms)` | Leading-edge: passes first value, silences further values for `ms` ms |
| `delay(ms)` | Delays each value by `ms` ms; resets to undefined on teardown |
| `bufferTime(ms)` | Time-windowed buffering; flushes accumulated arrays at fixed intervals |
| `timeout(ms)` | Errors if no value arrives within `ms` ms |
| `sample(notifier)` | Emits the latest value when notifier fires |
| `switchMap(fn)` | Maps to an inner store; unsubscribes from the previous inner on each outer change |
| `concatMap(fn)` | Maps to inner stores sequentially; queues outer values while inner is active |
| `exhaustMap(fn)` | Maps to an inner store; ignores new outer values while inner is active |
| `rescue(fn)` | On error, switches to a fallback store |
| `retry(n)` | Re-subscribes on error up to n times |
| `repeat(factory, n?)` | Re-subscribes via factory on completion, up to n total times |
| `audit(ms)` | Trailing-edge throttle; emits latest value after `ms` ms silence window |
| `bufferCount(count, startEvery?)` | Count-based buffering; tumbling (default) or sliding window |
| `reduce(fn, seed)` | Collects finite source into a single result via reducer; emits on completion |
| `toArray()` | Collects finite source values into an array; emits on completion |
| `groupBy(keyFn)` | Routes values into sub-stores by key; output is `Map<K, Store<V>>` |
| `race(...sources)` | Emits from whichever source fires first; unsubscribes others |
| `window(notifier)` | Splits values into nested window stores; new window on notifier emission |
| `windowCount(count)` | Splits values into nested window stores of `count` values each |
| `windowTime(ms)` | Splits values into nested window stores that last `ms` milliseconds each |

### Piping

| Module | Description |
|--------|-------------|
| `pipeRaw(source, ...fns)` | Fuses transform functions into a single `derived()` store for ~2x throughput |
| `SKIP` | Sentinel for filter semantics in `pipeRaw` — returning `SKIP` keeps the cached value |

### Sinks

| Module | Description |
|--------|-------------|
| `subscribe(store, cb)` | Listens to value changes with previous-value tracking; pure callbag sink |
| `forEach(cb)` | Subscribes to a source, calling `cb` for each value |

### Interop

| Module | Description |
|--------|-------------|
| `wrap(rawSource)` | Promotes a raw callbag source to a tier 2 Store (producer-based, autoDirty) |
| `wrap(input, rawOp)` | Promotes a raw callbag map-like operator to a tier 1 Store (STATE bypass for diamond resolution) |

**Constraint:** `wrap(input, rawOp)` is synchronous map-only. Filtering or tier 2 raw operators must use `operator()` directly with explicit signal handling. See `docs/archive/architecture-v4-review.md` §2.7 for full rationale.

---

## Testing strategy

Many of the original `callbag-*` repos (e.g., `callbag-take-until`, `callbag-debounce`, `callbag-switch-map`) have existing test suites that can be adapted to our vitest setup. Key patterns to test for each new module:

1. **Correctness** — values are emitted in the right order with the right timing
2. **Completion propagation** — END signals flow both upstream and downstream
3. **Teardown on unsubscribe** — sinks disconnecting mid-stream triggers cleanup (timers cleared, inner subs disposed, buffers released)
4. **No retained references** — after teardown, no closures hold references to values or sinks

---

## Orchestrate (`src/orchestrate/`) — Level 3E Workflow Engine

Orchestration primitives that compose with core to build reactive workflow pipelines. Import from `callbag-recharge/orchestrate`.

### Sources

| Module | Description |
|--------|-------------|
| `fromCron(expr, opts?)` | Tier 2 source that emits a `Date` on each cron schedule match. 5-field standard cron. Built-in parser (no external deps). |
| `fromTrigger<T>(opts?)` | Manual trigger source. `.fire(value)` emits into the stream. No dedup (always emits). |

### Orchestration operators

| Module | Description |
|--------|-------------|
| `gate<A>(opts?)` | Human-in-the-loop: pause stream, inspect pending, approve/reject/modify, resume. Reactive `pending` and `isOpen` stores. Tier 2. |
| `track<A>(opts?)` | Pipe-native task tracking. Observable metadata (status, duration, count, error) via reactive `meta` store. Tier 2. |
| `route<T>(source, pred, opts?)` | Dynamic conditional routing → `[matching, notMatching]` both as stores. Tier 1 (participates in diamond resolution). |
| `withBreaker<A>(breaker, opts?)` | Circuit breaker as pipe operator. Blocks when open, trials on half-open. Accepts `BreakerLike` interface. Observable `breakerState`. Tier 2. |
| `withRetry<A>(config)` | Retry + backoff as operator with observable retry state (attempt, lastError, pending). Accepts `DelayStrategy` or simple count. Tier 2. |
| `withTimeout<A>(ms)` | Timeout as pipe operator. Throws `TimeoutError` if no value arrives within `ms`. Tier 2. |

### Workflow builder

| Module | Description |
|--------|-------------|
| `pipeline<S>(steps, opts?)` | Declarative workflow builder. Steps declare deps, auto-wires via topological sort (Kahn's). Reactive status per step. `destroy()` for cleanup. |
| `step<T>(factory, deps?, opts?)` | Step definition for `pipeline()`. Factory receives dep stores in declared order. |

### Durable execution

| Module | Description |
|--------|-------------|
| `checkpoint(id, adapter, opts?)` | Durable step boundary. Persists values on emit, skips on recovery. Pluggable `CheckpointAdapter`. Tier 2. |
| `memoryAdapter()` | In-memory `CheckpointAdapter` implementation (for testing / non-durable use). |
| `fileAdapter(opts)` | File-based `CheckpointAdapter`. JSON files in a directory. Node.js only (async `import("node:fs/promises")`). |
| `sqliteAdapter(opts)` | SQLite `CheckpointAdapter` via better-sqlite3 (peer dep). Sync. Auto-creates table. Validates table name against SQL injection. |
| `indexedDBAdapter(opts?)` | IndexedDB `CheckpointAdapter` for browser. Async. Lazy DB open with cached promise. Handles `versionchange` for multi-tab. |
| `executionLog(opts?)` | Reactive execution history backed by `reactiveLog`. `connectPipeline()` auto-writes step events. `forStep()` O(1) lookup. `persistError` store surfaces adapter failures. |
| `memoryLogAdapter()` | In-memory `ExecutionLogPersistAdapter` for testing. |

### Task tracking

| Module | Description |
|--------|-------------|
| `taskState<T>(opts?)` | Reactive task execution tracker. `run(fn)` wraps sync/async with auto status/duration/error tracking. NodeV0 serializable. |

### DAG validation

| Module | Description |
|--------|-------------|
| `dag(nodes)` | Validates acyclicity (Kahn's algorithm), registers edges with Inspector. Returns topological order. |

### Utilities (exported for advanced use)

| Module | Description |
|--------|-------------|
| `parseCron(expr)` | Parse a 5-field cron expression into a `CronSchedule` object |
| `matchesCron(schedule, date)` | Check if a `Date` matches a parsed cron schedule |

---

## Adapters (`src/adapters/`) — External System Connectors

Thin source/sink wrappers for external systems. Import from `callbag-recharge/adapters`.

| Module | Description |
|--------|-------------|
| `fromWebhook<T>(opts?)` | HTTP trigger source (Node.js/edge). Creates a POST endpoint that emits parsed request bodies. Standalone (`listen()`) or embedded (`handler` property). Configurable path, port, body parser, max body size (default 1MB). Observable `requestCount` store. |
| `fromWebSocket<T>(url, opts?)` | Reactive WebSocket source. Observable `status` store ("connecting", "open", "closing", "closed"). Optional auto-reconnect with configurable delay. No external deps (browser-native WebSocket API). Works in Node.js 21+ and all modern browsers. |
| `toWebSocket<T>(ws, source, opts?)` | WebSocket sink. Sends store values to a WebSocket connection. Buffers messages until connection opens. Returns dispose function. |
| `toSSE<T>(source, opts?)` | Server-Sent Events sink. Streams store values to connected browser clients. Standalone (`listen()`) or embedded (`handler`). CORS preflight. Configurable ping keep-alive (default 30s). Observable `connectionCount` store. Unsubscribes from source when last client disconnects. |
| `fromHTTP<T>(url, opts?)` | Fetch-based HTTP source with polling, custom transform, timeout. Observable `status` ("idle"/"fetching"/"success"/"error") and `fetchCount` stores. `refetch()` for manual trigger. `stop()` cancels in-flight + resets status. Tier 2. |

---

## Roadmap: Patterns (`src/patterns/`)

Patterns are composed recipes using primitives + extras. Each solves a specific problem in ~20-50 lines. Higher-level than extras, still generic and reusable.

### P0 — Ship with first release (the killer demos)

#### `chatStream` — AI chat streaming primitive
```ts
const chat = chatStream({
  send: (messages) => fetchSSE('/api/chat', { messages }),  // returns AsyncIterable
  history: state<Message[]>([]),
})
// chat.response     — Store<string> (accumulated current response)
// chat.isStreaming   — Store<boolean>
// chat.error         — Store<Error | null>
// chat.send(prompt)  — sends, cancels any in-flight stream
// chat.cancel()      — manual cancel
// chat.retry()       — retry last message
```
Built from: `state`, `derived`, `producer`, `switchMap`, `scan`, `fromAsyncIter`

#### `cancellableAction` — async action with auto-cancel
```ts
const search = cancellableAction(async (query: string, signal: AbortSignal) => {
  const res = await fetch(`/api/search?q=${query}`, { signal })
  return res.json()
})
// search.trigger('hello')
// search.result    — Store<T | undefined>
// search.pending   — Store<boolean>
// search.error     — Store<Error | null>
```
Built from: `state`, `derived`, `producer`, `switchMap`

#### `rateLimiter` — rate-limit with configurable strategy
```ts
const limited = rateLimiter(source, {
  maxPerWindow: 10,
  windowMs: 1000,
  strategy: 'drop' | 'queue' | 'error',
})
```
Built from: `operator`, `bufferTime`, `scan`

### P1 — High value patterns

#### `undoRedo` — state with undo/redo history
```ts
const editor = undoRedo(state({ text: '', cursor: 0 }), { maxHistory: 50 })
// editor.current   — Store<T>
// editor.canUndo / canRedo — Store<boolean>
// editor.undo() / redo() / checkpoint()
```
Built from: `state`, `derived`, `scan`

#### `pagination` — paginated data fetching
```ts
const pages = pagination({
  fetch: (page, signal) => fetchUsers(page, { signal }),
  pageSize: 20,
})
// pages.data / page / hasNext / loading — all Store<T>
// pages.next() / prev() / goTo(n)
```
Built from: `state`, `derived`, `producer`, `switchMap`

#### `formField` — form field with sync + async validation
```ts
const email = formField('', {
  validate: (v) => v.includes('@') || 'Invalid email',
  asyncValidate: (v, signal) => checkAvailable(v, { signal }),
  debounceMs: 300,
})
// email.value / error / dirty / touched / valid — all Store<T>
// email.set('user@test.com') / reset()
```
Built from: `state`, `derived`, `effect`, `debounce`

### P2 — Specialized patterns

#### `connectionHealth` — heartbeat + auto-reconnect
Built from: `producer`, `interval`, `timeout`, `retry`, `state`

#### `batchWriter` — accumulate items, flush on count or time
Built from: `buffer`, `bufferTime`, `bufferCount`, `merge`

#### `stateMachine` — finite state machine with typed transitions
Built from: `state`, `derived`, `effect`, `scan`

---

## Roadmap: Compat Layers (`src/compat/`)

### P0 — Nanostores (~20-30 lines)
```ts
// callbag-recharge/compat/nanostores
export function atom<T>(initial: T): NanoAtom<T>     // wraps state()
export function computed<T>(...): NanoComputed<T>     // wraps derived()
export function map<T>(initial: T): NanoMap<T>        // wraps state() + setKey
// NanoAtom: .get(), .set(), .subscribe(), .listen()
```
Near-1:1 API match. Immediate positioning in Astro/multi-framework ecosystem.

### P1 — TC39 Signals (~50-80 lines)
```ts
// callbag-recharge/compat/signals
export namespace Signal {
  class State<T> { get(): T; set(v: T): void }         // wraps state()
  class Computed<T> { get(): T }                        // wraps derived()
  namespace subtle { class Watcher { ... } }            // wraps subscribe/effect
}
```
Positions as a Signals polyfill with bonus features (batching, diamond resolution, operators).

### P2 — Jotai (~80-120 lines)
```ts
// callbag-recharge/compat/jotai
export function atom<T>(initial: T): Atom<T>
export function atom<T>(read: (get) => T): DerivedAtom<T>
export function atom<T>(read, write): WritableAtom<T>
```
Needs a `get()` tracking wrapper for implicit dep detection.

### P2 — Zustand (~40-60 lines)
```ts
// callbag-recharge/compat/zustand
export function create<T>(fn: (set, get) => T): StoreApi<T>
```
Wraps a single `state()` with Zustand's set/get contract.

---

## Roadmap: Adapters (`src/adapters/`) — Future

Each adapter is a thin source/sink wrapper (~20-50 lines). The library handles the reactive logic.

| Adapter | Source | Sink | Priority | Dep strategy |
|---------|--------|------|----------|-------------|
| WebSocket | `fromWebSocket(url)` | `toWebSocket(ws)` | P1 | No deps (browser native) |
| Kafka | `fromKafka(consumer, topic)` | `toKafka(producer, topic)` | P2 | Peer dep on `kafkajs` |
| Redis | `fromRedis(sub, channel)` | `toRedis(pub, channel)` | P2 | Peer dep on `ioredis` |
| PostgreSQL | `fromPgNotify(pool, channel)` | — | P2 | Peer dep on `pg` |
| gRPC stream | `fromGrpcStream(call)` | `toGrpcStream(call)` | P3 | Peer dep on `@grpc/grpc-js` |
| NATS | `fromNats(nc, subject)` | `toNats(nc, subject)` | P3 | Peer dep on `nats` |

**Dependency strategy for adapters:**
- Core `callbag-recharge` remains **zero-dependency**
- Adapters that need external libs use **peer dependencies** — the user installs kafkajs/ioredis themselves
- Adapters that work with built-in APIs (WebSocket, fetch, EventSource) have no extra deps
- All adapters are tree-shakeable via subpath exports: `callbag-recharge/adapters/kafka`

---

## Package Structure

```
src/
  ├── (core)           state, derived, effect, producer, operator, pipe, batch, inspector
  ├── extra/           low-level operators — building blocks
  │                    (switchMap, debounce, scan, fromEvent, merge, retry, ...)
  ├── patterns/        composed recipes — solve specific problems
  │                    (chatStream, cancellableAction, rateLimiter, undoRedo, ...)
  ├── compat/          drop-in API replacements — get adoption
  │   ├── nanostores/
  │   ├── signals/
  │   ├── jotai/
  │   └── zustand/
  └── adapters/        external system connectors — expand reach
      ├── websocket/
      ├── kafka/
      └── redis/
```

Import paths:
```ts
import { state, derived, effect }    from 'callbag-recharge'           // core
import { switchMap, debounce }       from 'callbag-recharge/extra'     // operators
import { chatStream }               from 'callbag-recharge/patterns'   // recipes
import { atom, computed }            from 'callbag-recharge/compat/nanostores'
import { fromKafka }                 from 'callbag-recharge/adapters/kafka'
```

Each layer builds on the one below. `patterns/` imports from `extra/` + core. `compat/` wraps core. `adapters/` produce/consume via core. Everything tree-shakes independently.

**Note:** Extras may use any of the 6 core primitives (`state`, `derived`, `dynamicDerived`, `producer`, `operator`, `effect`) — whichever makes the implementation cleanest.
