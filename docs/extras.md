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
| `remember` | Caches the last upstream value and replays it to new subscribers |
| `merge(...sources)` | Merges multiple sources into one |
| `combine(...sources)` | Emits arrays of latest values when any source updates |
| `concat(...sources)` | Subscribes to sources sequentially |
| `flat` | Flattens a source of sources (mergeAll semantics) |
| `share` | Shares a single upstream subscription across multiple sinks |
| `buffer(notifier)` | Accumulates values into arrays; flushes on notifier emission |
| `withLatestFrom(...others, fn)` | When source emits, grabs current values from others; primary+secondary dep pattern (see architecture §4) |
| `subject` | Multicast primitive; both a source and manual emitter |

### Tier 2 operators (cycle boundaries, built on `producer()`)

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

---

## Testing strategy

Many of the original `callbag-*` repos (e.g., `callbag-take-until`, `callbag-debounce`, `callbag-switch-map`) have existing test suites that can be adapted to our vitest setup. Key patterns to test for each new module:

1. **Correctness** — values are emitted in the right order with the right timing
2. **Completion propagation** — END signals flow both upstream and downstream
3. **Teardown on unsubscribe** — sinks disconnecting mid-stream triggers cleanup (timers cleared, inner subs disposed, buffers released)
4. **No retained references** — after teardown, no closures hold references to values or sinks

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
