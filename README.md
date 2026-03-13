# callbag-recharge

Reactive stores connected by the [callbag protocol](https://github.com/callbag/callbag). Every node is a store you can see into.

- **~4 KB** minified, zero dependencies
- **Glitch-free** diamond updates via push-pull architecture
- **~376 bytes per store** — plain objects, no wrapper overhead
- **Full TypeScript** from the ground up

```ts
import { state, derived, effect, pipe, map, filter } from 'callbag-recharge'

const count = state(0)
const doubled = derived(() => count.get() * 2)

effect(() => {
  console.log(doubled.get()) // 0, then 10
})

count.set(5)
```

---

## Why callbag-recharge?

Signals gave us ergonomic reactive state. Callbag gave us zero-overhead push/pull streams. This library combines both — signals-style ergonomics with callbag's protocol underneath — and adds something neither has: **every node in the reactive graph is inspectable**.

| Feature | RxJS | Signals | Callbag | callbag-recharge |
|---|---|---|---|---|
| Inspect intermediate values | No | Derivations only | No | **Every step** |
| Push + pull unified | No | Pull only | Yes (opaque) | **Yes (inspectable)** |
| Glitch-free diamonds | N/A | Yes | No | **Yes** |
| Bundle size | ~30 KB | ~3-5 KB | ~1-2 KB | **~4 KB** |
| Memory per node | Heavy | Medium | Minimal | **~376 bytes** |

---

## Quick start

```ts
// Writable state — the source of truth
const count = state(0)
count.set(5)
count.get() // 5

// Derived — auto-tracks dependencies, no cache, always fresh
const doubled = derived(() => count.get() * 2)
doubled.get() // 10

// Stream — push-based, pull-based, or both
const ticks = stream<number>(emit => {
  const id = setInterval(() => emit(Date.now()), 1000)
  return () => clearInterval(id)
})

// Effect — batched, re-runs when deps change
const dispose = effect(() => {
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

## Design principles

1. **Stores are plain objects** — `{ get, set?, source }`, no classes, no property descriptors
2. **Push invalidation, pull computation** — DIRTY symbol propagates instantly; values computed lazily on `.get()`
3. **No cache in derived stores** — always recompute, no dirty flags or version counters
4. **`undefined` means empty** — no special symbols, no `.ready` flag
5. **Observability is external** — Inspector singleton with WeakMaps, zero per-store cost

See [docs/architecture.md](./docs/architecture.md) for the full design and implementation details.

---

## Callbag interop

Every store exposes a `.source` property — a standard callbag source function. The `DIRTY` symbol is exported for consumers that need to distinguish invalidation signals from data.

```ts
import { DIRTY } from 'callbag-recharge'

store.source(0, (type, data) => {
  if (type === 1 && data === DIRTY) { /* invalidation */ }
  if (type === 1 && data !== DIRTY) { /* actual value */ }
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
