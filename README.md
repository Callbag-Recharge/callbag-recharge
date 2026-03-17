# callbag-recharge

**State that flows.** Reactive state management for TypeScript, built on the [callbag protocol](https://github.com/callbag/callbag).

- **~1.1 KB** core ESM, zero dependencies
- **Glitch-free** diamond updates via two-phase push
- **~376 bytes per store** — plain objects, no wrapper overhead
- **Full TypeScript** from the ground up

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

- **Simple state management** — like Zustand/Jotai but framework-agnostic, no providers
- **Streaming data** — LLM chunks, WebSocket, SSE flowing into state via `producer` or `fromAsyncIter`
- **Cancellable async** — `switchMap` auto-cancels previous operations
- **Derived/computed values** — always consistent, diamond-safe, cached
- **Agentic workflows** — session state, tool call lifecycle, multi-agent coordination
- **Event pipelines** — 60+ tree-shakeable operators for transform, buffer, window, error handling

---

## Why callbag-recharge?

Signals gave us ergonomic reactive state. Callbag gave us zero-overhead streams. This library combines both — signals-style ergonomics with callbag's protocol underneath — and adds something neither has: **every node in the reactive graph is inspectable**.

| Feature | RxJS | Signals | Callbag | callbag-recharge |
|---|---|---|---|---|
| Inspect intermediate values | No | Derivations only | No | **Every step** |
| Two-phase push (glitch-free) | N/A | Yes | No | **Yes** |
| Bundle size | ~30 KB | ~3-5 KB | ~1-2 KB | **~1.1 KB** (core) |
| Memory per node | Heavy | Medium | Minimal | **~376 bytes** |

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

## 60+ operators, tree-shakeable

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
4. **Cached derived stores** — STANDALONE mode: eagerly connects to deps, `get()` always returns cached value
5. **`undefined` means empty** — no special symbols, no `.ready` flag
6. **Observability is external** — Inspector singleton with WeakMaps, zero per-store cost

See [docs/architecture.md](./docs/architecture.md) for the full design and implementation details.

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
- [Benchmarks](./docs/benchmarks.md) — head-to-head comparison vs Preact Signals and raw Callbag
- [Optimizations](./docs/optimizations.md) — techniques to close performance gaps

---

## Install

```bash
npm install callbag-recharge
```

---

## License

MIT
