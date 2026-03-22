# callbag-recharge

**State that flows.** Reactive state management for TypeScript — from simple atoms to streaming pipelines, in one library.

- **6 primitives** — `state`, `derived`, `dynamicDerived`, `effect`, `producer`, `operator`
- **70+ operators** — `switchMap`, `debounce`, `scan`, `retry`, and more — tree-shakeable
- **170+ modules** across 12 categories — core, extra, utils, data, orchestrate, messaging, worker, memory, patterns, adapters, compat, raw
- **Glitch-free** — two-phase push resolves diamonds correctly, every time
- **Streaming-native** — LLM chunks, WebSocket, SSE are first-class, not bolted on
- **Lifecycle signals** — RESET, PAUSE, RESUME, TEARDOWN propagate through the graph as TYPE 3 STATE signals
- **Inspectable** — every node in the graph is observable via `Inspector` — names, edges, phases, values
- **Framework-agnostic** — Vue, React, Svelte, Solid bindings via `compat/`; works anywhere JS runs
- Zero dependencies

```ts
import { state, derived, effect } from 'callbag-recharge'

const count = state(0)
const doubled = derived([count], () => count.get() * 2)

effect([doubled], () => {
  console.log(doubled.get()) // 0, then 10
})

count.set(5)
```

---

## When to use

- **Simple state management** — like Zustand/Jotai but framework-agnostic, no providers, no ceremony
- **Streaming data** — LLM token streams, WebSocket, SSE flowing into reactive state via `producer` or `fromAsyncIter`
- **Cancellable async** — `switchMap` auto-cancels the previous operation when a new one starts
- **Derived values you can trust** — diamond-safe, cached, always consistent
- **On-device / edge LLM streaming** — manage WebLLM, Ollama, or ExecuTorch token streams as reactive sources
- **Hybrid cloud+edge model routing** — confidence-based routing between local and cloud LLMs with automatic fallback via `route()` + `rescue()`
- **Tool call state machines** — reactive state machines for LLM tool call lifecycle using `stateMachine` + `producer`
- **Agentic workflows** — session state, tool call lifecycle, multi-agent coordination, memory with decay-scored eviction
- **Event pipelines** — transform, buffer, window, throttle, retry — compose with `pipe`
- **Reactive data structures** — `reactiveMap`, `reactiveLog`, `reactiveIndex` with near-native read performance
- **Messaging** — Pulsar-inspired `topic`/`subscription` with `jobQueue`, `jobFlow`, and `repeatPublish`
- **Cross-thread reactivity** — `workerBridge`/`workerSelf` for Web Workers, SharedWorker, and service workers
- **Scheduled pipelines** — cron triggers, task state tracking, DAG validation — Airflow-in-TypeScript
- **Durable workflows** — checkpoint persistence (file, SQLite, IndexedDB), execution logging, pipeline builder with topological sort

---

## Why callbag-recharge?

Most state managers stop at atoms and computed values. Most streaming libraries don't have state. This library is both — signals-style `.get()/.set()` ergonomics with callbag's streaming protocol underneath.

**What you get that others don't — all in one library:**

- **Glitch-free diamond resolution** — when A → B, A → C, B+C → D, D computes exactly once with consistent values. Jotai, Nanostores, and vanilla signals all glitch here.
- **Streaming operators as first-class citizens** — `switchMap`, `debounce`, `throttle`, `scan`, `retry`, `bufferTime` — not an afterthought, not a separate library.
- **Lifecycle signals** — RESET, PAUSE, RESUME, TEARDOWN propagate through the reactive graph as TYPE 3 STATE signals. No imperative teardown lists.
- **Inspectable graph** — every store has a name, a kind, dependency edges, and a status. `Inspector.graph()` shows the full picture. No other state manager gives you this without runtime cost in production.
- **Effects with dirty tracking** — `effect()` knows which deps changed and waits for all to resolve before running. Smarter than `useEffect`, `autorun`, or `watch`.
- **Completion and error semantics** — stores can complete and error, just like streams. `retry`, `rescue`, `repeat` handle recovery. No ad-hoc try/catch.
- **Built-in batching** — `batch()` defers value propagation until all writes finish. No torn reads mid-update.
- **Reactive data structures** — `reactiveMap`, `reactiveLog`, `reactiveIndex` — near-native reactive collections that no competitor offers.
- **Full-stack reactive** — messaging, worker bridges, adapters (LLM, WebSocket, SSE, MCP), and framework bindings — all built on the same 6 primitives.

---

## Quick start

```ts
import { state, derived, effect, pipe, producer, Inspector } from 'callbag-recharge'
import { map, filter, scan, subscribe } from 'callbag-recharge/extra'

// Writable state — the source of truth
const count = state(0)
count.set(5)
count.get() // 5

// Derived — explicit deps, cached, always fresh
const doubled = derived([count], () => count.get() * 2)
doubled.get() // 10

// Producer — push-based source with cleanup
const ticks = producer<number>(({ emit }) => {
  const id = setInterval(() => emit(Date.now()), 1000)
  return () => clearInterval(id)
})

// Effect — explicit deps, re-runs when deps change
const dispose = effect([doubled], () => {
  console.log(doubled.get())
  return () => { /* cleanup */ }
})

// Pipe — each step is an inspectable store
const result = pipe(
  count,
  map(n => n * 2),
  filter(n => n > 0),
  scan((acc, n) => acc + n, 0),
)

// Subscribe — listen to value changes
const unsub = subscribe(count, (value, prev) => {
  console.log(`${prev} → ${value}`)
})

// Inspect the entire reactive graph
Inspector.graph()
// Map { 'count' => { kind: 'state', value: 5 }, ... }
```

---

## 70+ operators, tree-shakeable

Import only what you need from `callbag-recharge/extra`.

**Sources** — `interval` · `fromIter` · `fromAsyncIter` · `fromEvent` · `fromPromise` · `fromObs` · `fromAny` · `fromTimer` · `fromTrigger` · `fromCron` · `of` · `empty` · `throwError` · `never`

**Filtering** — `filter` · `take` · `skip` · `first` · `last` · `find` · `elementAt` · `distinctUntilChanged` · `takeUntil` · `takeWhile`

**Transformation** — `map` · `scan` · `pairwise` · `startWith` · `flat` · `switchMap` · `concatMap` · `exhaustMap` · `groupBy` · `streamParse`

**Combination** — `merge` · `combine` · `concat` · `race` · `withLatestFrom` · `partition`

**Time** — `debounce` · `throttle` · `delay` · `timeout` · `sample` · `audit`

**Buffering** — `buffer` · `bufferCount` · `bufferTime`

**Windowing** — `window` · `windowCount` · `windowTime`

**Aggregation** — `reduce` · `toArray`

**Error handling** — `rescue` · `retry` · `repeat` · `route`

**Utilities** — `tap` · `share` · `remember` · `cached` · `pausable` · `subject` · `wrap` · `firstValueFrom`

**Piping** — `pipeRaw` · `SKIP`

**Sinks** — `forEach` · `subscribe`

---

## Design principles

1. **Stores are plain objects** — `{ get, set?, source }`, no classes, no property descriptors
2. **Two-phase push** — DIRTY propagates on type 3, then values flow on type 1; glitch-free diamonds without pull
3. **Explicit deps** — `derived` and `effect` declare dependencies upfront; callbag protocol is the sole connection mechanism
4. **Lazy derived** — no computation at construction. `get()` pull-computes from deps (always fresh). `source()` subscription triggers push-based connection; disconnects when last subscriber leaves
5. **`undefined` means empty** — no special symbols, no `.ready` flag
6. **Observability is external** — Inspector singleton with WeakMaps, zero per-store cost

See [docs/architecture.md](./docs/architecture.md) for the full design and implementation details.

---

## Reactive data structures

Built on the core primitives, these provide reactive wrappers around common data structures with near-native read performance.

```ts
import { reactiveMap, reactiveLog, reactiveIndex } from 'callbag-recharge/data'

// Reactive Map — .get()/.set() with observable changes
const users = reactiveMap<string, User>()
users.set('alice', { name: 'Alice' })
const alice = users.select('alice') // Store<User | undefined> — reactive, cached

// Reactive Log — append-only with bounded mode (circular buffer)
const log = reactiveLog<string>({ maxSize: 1000 })
log.append('event happened')
const recent = log.slice(-10) // Store<string[]> — reactive

// Reactive Index — dual-key lookup, 1.01x native Map.get speed on reads
const index = reactiveIndex<string, string, Item>()
index.set('pk', 'sk', item)
const found = index.select('pk', 'sk') // Store<Item | undefined>
```

---

## Scheduling & orchestration

17 orchestration nodes — diamond resolution IS the DAG executor.

```ts
import { task, pipeline, gate, sensor, forEach } from 'callbag-recharge/orchestrate'
import { pipe } from 'callbag-recharge'
import { exhaustMap, retry } from 'callbag-recharge/extra'

// Pipeline — DAG with topological sort, checkpoints, execution logging
const etl = pipeline('daily-etl', [
  task('fetch-bank', () => plaid.sync()),
  task('fetch-cards', () => stripe.charges()),
  task('aggregate', () => merge(bank, cards), { deps: ['fetch-bank', 'fetch-cards'] }),
])

// Gate — hold values until a condition store is true
const approved = gate(data, approvalStore)

// Sensor — reactive condition monitor
const ready = sensor([dbHealth, cacheHealth], () => dbHealth.get() && cacheHealth.get())

// forEach — run a side-effect for each value from a source
forEach(events, (signal, event) => process(event))
```

`task` · `taskState` · `pipeline` · `pipelineRunner` · `gate` · `sensor` · `forEach` · `branch` · `join` · `loop` · `wait` · `approval` · `onFailure` · `subPipeline` · `executionLog` · `diagram` · `fromCron`

---

## Agent memory

Reactive memory primitives for agentic workflows — push-based dirty tracking, decay-scored eviction, tag-based retrieval.

```ts
import { collection, memoryNode } from 'callbag-recharge/memory'

const memory = collection<string>({ maxSize: 100 })
memory.add('User prefers TypeScript', { id: 'pref-1', tags: ['preference'] })

// Tag-based retrieval via reactive index
memory.tagIndex.select('preference').get() // Set{'pref-1'}

// Decay-scored eviction — oldest/least important items evicted first
```

---

## Messaging

Pulsar-inspired reactive pub/sub — topics, subscriptions, and job processing built on callbag stores.

```ts
import { topic, subscription, jobQueue, jobFlow } from 'callbag-recharge/messaging'

// Topic — named pub/sub channel
const events = topic<{ type: string; payload: unknown }>('events')

// Subscription — filtered, reactive consumer
const clicks = subscription(events, msg => msg.type === 'click')

// Job queue — ordered processing with concurrency control
const queue = jobQueue<Task>(tasks, { concurrency: 3 })

// Job flow — multi-step pipeline with per-step handlers
const flow = jobFlow<Input, Output>(source, [step1, step2, step3])
```

---

## Worker bridge

Cross-thread reactive stores — Web Workers, SharedWorker, and service workers.

```ts
// Main thread
import { workerBridge } from 'callbag-recharge/worker'
const bridge = workerBridge(new Worker('./worker.ts'))
const remoteCount = bridge.get('count') // Store<number> — reactive across threads

// Worker thread
import { workerSelf } from 'callbag-recharge/worker'
const self = workerSelf()
self.expose('count', countStore)
```

---

## Patterns

16 ready-made patterns built on the primitives — import and go.

`createStore` · `chatStream` · `commandBus` · `focusManager` · `formField` · `hybridRoute` · `memoryStore` · `pagination` · `rateLimiter` · `selection` · `textBuffer` · `textEditor` · `toolCallState` · `undoRedo` · `agentLoop`

---

## Adapters & compatibility

**Adapters** (`callbag-recharge/adapters`) — `fromLLM` · `fromWebSocket` · `fromSSE` · `fromWebhook` · `fromHTTP` · `fromMCP`

**Framework bindings** (`callbag-recharge/compat/*`) — Vue · React · Svelte · Solid · Zustand · Jotai · Nanostores · TC39 Signals

---

## Callbag interop

Every store exposes a `.source` property — a standard callbag source function. State management signals (DIRTY, RESOLVED) and lifecycle signals (RESET, PAUSE, RESUME, TEARDOWN) flow on the type 3 STATE channel, keeping type 1 DATA for real values only.

```ts
import { STATE, DIRTY, RESOLVED, RESET, PAUSE, RESUME, TEARDOWN } from 'callbag-recharge'

store.source(0, (type, data) => {
  if (type === 3 && data === DIRTY)    { /* invalidation */ }
  if (type === 3 && data === RESOLVED) { /* resolved unchanged */ }
  if (type === 3 && data === PAUSE)    { /* paused */ }
  if (type === 3 && data === RESET)    { /* reset to initial */ }
  if (type === 1)                      { /* value */ }
})

// Send lifecycle signals through the graph
sub.signal(PAUSE)    // pause downstream
sub.signal(RESUME)   // resume downstream
sub.signal(RESET)    // reset to initial state
sub.signal(TEARDOWN) // tear down the subgraph
```

---

## Documentation

- **[Docs site](https://callbag-recharge.github.io/callbag-recharge/)** — getting started, API reference, recipes
- [Architecture](./docs/architecture.md) — layers, design principles, how each primitive works
- [Extras](https://callbag-recharge.github.io/callbag-recharge/api/) — operators, sources, and sinks (API reference)
- [Recipes](https://callbag-recharge.github.io/callbag-recharge/recipes/) — AI chat streaming, data pipelines, and more
- [llms.txt](./llms.txt) / [llms-full.txt](./llms-full.txt) — AI-readable documentation
- [Benchmarks](./docs/benchmarks.md) — Vitest + tinybench (`pnpm run bench`)

---

## Install

```bash
npm i @callbag-recharge/callbag-recharge
```

---

## Contributing

Clone, run `corepack enable` and `pnpm install`, then `pnpm test` / `pnpm run build`. See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for commits; maintainers see **[docs/github-actions-release-setup.md](./docs/github-actions-release-setup.md)** for npm/GitHub Actions secrets.

---

## License

MIT
