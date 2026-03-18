# callbag-recharge

**State that flows.** Reactive state management for TypeScript — from simple atoms to streaming pipelines, in one library.

- **5 primitives** — `state`, `derived`, `effect`, `producer`, `operator`
- **58 operators** — `switchMap`, `debounce`, `scan`, `retry`, and more — tree-shakeable
- **Glitch-free** — two-phase push resolves diamonds correctly, every time
- **Inspectable** — every node in the graph is observable via `Inspector` — names, edges, phases, values
- **Framework-agnostic** — no providers, no wrappers, works anywhere JS runs
- **~4.75 KB** gzipped core, zero dependencies

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
- **Streaming data** — LLM chunks, WebSocket, SSE flowing into state via `producer` or `fromAsyncIter`
- **Cancellable async** — `switchMap` auto-cancels the previous operation when a new one starts
- **Derived values you can trust** — diamond-safe, cached, always consistent
- **Agentic workflows** — session state, tool call lifecycle, multi-agent coordination
- **Event pipelines** — transform, buffer, window, throttle, retry — compose with `pipe`
- **Reactive data structures** — `reactiveMap`, `reactiveLog`, `reactiveIndex` with near-native read performance
- **Scheduled pipelines** — cron triggers, task state tracking, DAG validation — Airflow-in-TypeScript

---

## Why callbag-recharge?

Most state managers stop at atoms and computed values. Most streaming libraries don't have state. This library is both — signals-style `.get()/.set()` ergonomics with callbag's streaming protocol underneath.

**What you get that others don't — all in one library:**

- **Glitch-free diamond resolution** — when A → B, A → C, B+C → D, D computes exactly once with consistent values. Jotai, Nanostores, and vanilla signals all glitch here.
- **Streaming operators as first-class citizens** — `switchMap`, `debounce`, `throttle`, `scan`, `retry`, `bufferTime` — not an afterthought, not a separate library.
- **Inspectable graph** — every store has a name, a kind, dependency edges, and a status. `Inspector.graph()` shows the full picture. No other state manager gives you this without runtime cost in production.
- **Effects with dirty tracking** — `effect()` knows which deps changed and waits for all to resolve before running. Smarter than `useEffect`, `autorun`, or `watch`.
- **Completion and error semantics** — stores can complete and error, just like streams. `retry`, `rescue`, `repeat` handle recovery. No ad-hoc try/catch.
- **Built-in batching** — `batch()` defers value propagation until all writes finish. No torn reads mid-update.
- **Reactive data structures** — `reactiveMap` (1.56x native Map), `reactiveLog` (2.5x native), `reactiveIndex` (1.01x native reads) — near-native reactive collections that no competitor offers.

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

## 58 operators, tree-shakeable

Import only what you need from `callbag-recharge/extra`.

**Sources** — `interval` · `fromIter` · `fromAsyncIter` · `fromEvent` · `fromPromise` · `fromObs` · `of` · `empty` · `throwError` · `never`

**Filtering** — `filter` · `take` · `skip` · `first` · `last` · `find` · `elementAt` · `distinctUntilChanged` · `takeUntil`

**Transformation** — `map` · `scan` · `pairwise` · `startWith` · `flat` · `switchMap` · `concatMap` · `exhaustMap` · `groupBy`

**Combination** — `merge` · `combine` · `concat` · `race` · `withLatestFrom` · `partition`

**Time** — `debounce` · `throttle` · `delay` · `timeout` · `sample` · `audit`

**Buffering** — `buffer` · `bufferCount` · `bufferTime`

**Windowing** — `window` · `windowCount` · `windowTime`

**Aggregation** — `reduce` · `toArray`

**Error handling** — `rescue` · `retry` · `repeat`

**Utilities** — `tap` · `share` · `remember` · `subject` · `wrap`

**Piping** — `pipeRaw` · `SKIP`

**Sinks** — `forEach` · `subscribe`

---

## Design principles

1. **Stores are plain objects** — `{ get, set?, source }`, no classes, no property descriptors
2. **Two-phase push** — DIRTY propagates on type 3, then values flow on type 1; glitch-free diamonds without pull
3. **Explicit deps** — `derived` and `effect` declare dependencies upfront; callbag protocol is the sole connection mechanism
4. **Cached derived stores** — lazy STANDALONE mode: no computation until first `get()` or `source()`; then cached
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

Lightweight scheduling primitives that compose with `derived()` + `effect()` — diamond resolution IS the DAG executor.

```ts
import { fromCron, taskState, dag } from 'callbag-recharge/orchestrate'
import { pipe } from 'callbag-recharge'
import { exhaustMap, retry } from 'callbag-recharge/extra'

// Cron-triggered pipeline with retry
const daily = fromCron('0 9 * * *')
const fetchBank = pipe(daily, exhaustMap(() => fromPromise(plaid.sync())), retry(3))
const fetchCards = pipe(daily, exhaustMap(() => fromPromise(stripe.charges())), retry(3))

// Diamond resolution ensures aggregate runs once when both complete
const aggregate = derived([fetchBank, fetchCards], () => merge(fetchBank.get(), fetchCards.get()))

// Task state tracking
const task = taskState<Result>({ id: 'daily-sync' })
await task.run(() => syncAll())
task.get().status   // 'success'
task.get().duration // ms
```

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

## Callbag interop

Every store exposes a `.source` property — a standard callbag source function. State management signals (DIRTY, RESOLVED) flow on the type 3 STATE channel, keeping type 1 DATA for real values only.

```ts
import { STATE, DIRTY, RESOLVED } from 'callbag-recharge'

store.source(0, (type, data) => {
  if (type === 3 && data === DIRTY)    { /* invalidation */ }
  if (type === 3 && data === RESOLVED) { /* resolved unchanged */ }
  if (type === 1)                      { /* value */ }
})
```

---

## Documentation

- [Architecture](./docs/architecture.md) — layers, design principles, how each primitive works
- [State Management Strategy](./docs/state-management.md) — positioning, comparisons, GEO strategy
- [Extras](./docs/extras.md) — 58 operators, sources, and sinks
- [Benchmarks](./docs/benchmarks.md) — Vitest + tinybench (`pnpm run bench`)

---

## Install

```bash
npm install callbag-recharge
```

---

## Contributing

Clone, run `corepack enable` and `pnpm install`, then `pnpm test` / `pnpm run build`. See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for commits; maintainers see **[docs/github-actions-release-setup.md](./docs/github-actions-release-setup.md)** for npm/GitHub Actions secrets.

---

## License

MIT
