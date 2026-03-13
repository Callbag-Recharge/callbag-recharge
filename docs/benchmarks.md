# Benchmarks

Comparative benchmarks against [@preact/signals-core](https://github.com/preactjs/signals) (the most widely used signals implementation) and raw [callbag](https://github.com/callbag/callbag) utilities.

All benchmarks run 100,000 iterations after 1,000 warmup iterations on Node.js. Hardware variations will shift absolute numbers, but relative comparisons hold.

---

## Results

### State read

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **139M** | 0.7ms |
| Preact Signals | 131M | 0.8ms |

Plain-object stores with a simple `.get()` method are slightly faster than Preact's class-based signal instances.

### State write (no subscribers)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **39M** | 2.5ms |
| Preact Signals | 35M | 2.8ms |

Both perform an `Object.is` check and update. Recharge wins slightly because `pushDirty()` on an empty sinks set is a no-op.

### Computed read after dependency change

| Library | ops/sec | time (100K ops) |
|---|---|---|
| Preact Signals | **17M** | 6.0ms |
| callbag-recharge | 10M | 10.2ms |

Preact checks a dirty flag and recomputes only if needed. Recharge always recomputes (no cache). The 1.7x gap is the cost of unconditional function execution + tracking context setup.

### Computed read (unchanged dependencies)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| Preact Signals (cached) | **90M** | 1.1ms |
| callbag-recharge (recomputes) | 15M | 6.9ms |

This is the largest gap. Preact returns its cached value after a single flag check. Recharge runs the full computation function + tracking context every time. This is the deliberate no-cache tradeoff — see [optimizations](./optimizations.md) for how to close this gap.

### Diamond (A→B, A→C, B+C→D) write + read

| Library | ops/sec | time (100K ops) |
|---|---|---|
| Preact Signals | **10M** | 10.2ms |
| callbag-recharge | 4M | 23.1ms |

Both produce correct, glitch-free results. Preact is faster because its cached computed nodes skip recomputation when a dependency's value didn't actually change. Recharge recomputes every derived node in the pull chain.

### Effect re-run

| Library | ops/sec | time (100K ops) |
|---|---|---|
| Preact Signals | **13M** | 7.5ms |
| callbag-recharge | 4M | 25.6ms |

Recharge effects go through more machinery: DIRTY propagation → enqueue → flush → tracked re-run → callbag reconnection. Preact's effect system is tightly integrated with its version-counter-based invalidation.

### Pipe (3 operators) push through

| Library | ops/sec | time (100K ops) |
|---|---|---|
| raw Callbag | **84M** | 1.2ms |
| callbag-recharge | 5M | 19.2ms |

The largest relative gap. Raw callbag operators are nested function calls with zero allocation. Recharge pipe operators are `derived` stores — each step creates a tracking context, discovers dependencies, and potentially reconnects callbag sinks.

### Fan-out (10 subscribers)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| Preact Signals | **4M** | 28.4ms |
| callbag-recharge | 3M | 36.4ms |

Comparable. Both iterate through subscriber collections and invoke callbacks.

### Memory per store (10,000 stores)

| Library | bytes/store | heap delta |
|---|---|---|
| Preact Signals | **115 bytes** | 1,125 KB |
| callbag-recharge | 376 bytes | 3,667 KB |

Preact signals are highly optimized class instances. Recharge stores are plain objects with a `Set` for sinks plus a `WeakRef` registration in the Inspector.

---

## Where callbag-recharge wins

- **State read/write** — plain objects are faster than class instances for simple operations
- **Simplicity** — no dirty flags, no version counters, no topological sort — the lazy pull model gets correctness for free
- **Inspectability** — neither Preact Signals nor raw Callbag offer `Inspector.graph()` or per-step readability in pipelines

## Where Preact Signals wins

- **Cached computed reads** — 6x faster when dependencies haven't changed
- **Diamond patterns** — 2.5x faster due to caching skipping unnecessary recomputation
- **Effects** — 3x faster due to tighter integration with the invalidation system
- **Memory** — 3x smaller per store

## Where raw Callbag wins

- **Pipe throughput** — 16x faster because operators are just nested function calls with no store overhead

---

## Perspective

All numbers are in the **millions of operations per second**. For context:

- A typical UI re-renders at 60fps = 16ms per frame
- At 4M ops/sec (our slowest), you can perform **64,000 reactive operations per frame**
- Most applications have dozens to hundreds of reactive nodes, not thousands

The performance gaps matter for:
- Libraries building on top of callbag-recharge
- Applications with thousands of derived nodes reading on every frame
- High-frequency data streaming (use raw callbag pipes instead)

For typical application development, all three libraries are more than fast enough. callbag-recharge's value proposition is not raw speed — it's **inspectability + unified push/pull + correctness** at a performance level that never becomes a bottleneck in practice.

---

## Reproducing

```bash
npm install
npx tsx bench-compare.ts
```
