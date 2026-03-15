# Benchmarks

Comparative benchmarks against [@preact/signals-core](https://github.com/preactjs/signals) (the most widely used signals implementation) and raw [callbag](https://github.com/callbag/callbag) utilities.

All benchmarks run 100,000 iterations after 1,000 warmup iterations on Node.js. Hardware variations will shift absolute numbers, but relative comparisons hold.

---

## Results

### State read

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **146M** | 0.7ms |
| Preact Signals | 123M | 0.8ms |

Plain-object stores with a simple `.get()` method are faster than Preact's class-based signal instances. The explicit deps refactor removed `registerRead()` from `.get()`, making reads even cheaper.

### State write (no subscribers)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **42M** | 2.4ms |
| Preact Signals | 38M | 2.6ms |

Both perform an `Object.is` check and update. Recharge wins slightly because `pushDirty()` on an empty sinks set is a no-op. Custom `equals` functions are supported for structural equality.

### Computed/derived read after dependency change

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **71M** | 1.4ms |
| Preact Signals | 16M | 6.2ms |

With explicit deps, `get()` is a pure pull — just calls `fn()` with no tracking context setup, no Set allocation, and no dependency diffing. Recharge is ~4x faster than Preact for computed reads after a dep change.

### Computed/derived read (unchanged dependencies)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge (recomputes)** | **138M** | 0.7ms |
| Preact Signals (cached) | 94M | 1.1ms |

With the tracking context removed, `get()` is just a function call — even without caching, it's ~1.5x faster than Preact's cached flag check. Providing `equals` on a derived store enables pull-phase caching that skips downstream updates when the output hasn't changed.

### Diamond (A→B, A→C, B+C→D) write + read

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **41M** | 2.4ms |
| Preact Signals | 10M | 9.9ms |

Both produce correct, glitch-free results. Recharge is ~4x faster than Preact because explicit deps eliminated per-pull dependency re-discovery and reconnection overhead. Adding `equals` to intermediate derived stores can further reduce unnecessary downstream propagation.

### Effect re-run

| Library | ops/sec | time (100K ops) |
|---|---|---|
| Preact Signals | **14M** | 7.3ms |
| callbag-recharge | 10M | 10.6ms |

Effects use static deps (connect once on creation, no reconnection per re-run). The remaining gap vs Preact is the type 3 DIRTY/RESOLVED signaling overhead and enqueue/flush cycle. Use `batch()` to coalesce multiple state changes into a single effect run.

### Producer emit + get (with subscriber)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **21M** | 4.7ms |
| Preact Signals | 17M | 6.0ms |

`producer()` is the general-purpose source primitive. Emit sends DIRTY (type 3) then DATA (type 1) to all sinks. Compared against Preact `signal.value =` with one subscriber. Recharge wins because the callbag sink iteration is cheaper than Preact's effect scheduling.

### Operator (1 dep, transform)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **19M** | 5.3ms |
| Preact computed | 13M | 7.8ms |

`operator()` is the general-purpose transform primitive — receives all signal types from upstream and decides what to forward. Compared against Preact `computed` with one subscriber. The handler-based dispatch adds minimal overhead over raw derived reads.

### Pipe (3 operators) push through

| Library | ops/sec | time (100K ops) |
|---|---|---|
| raw Callbag | **104M** | 1.0ms |
| callbag-recharge `pipe` | 41M | 2.5ms |

Raw callbag operators are nested function calls with zero allocation. Recharge `pipe` operators are `derived` stores — each step is lightweight but adds per-step store overhead. Use `pipeRaw` when you need the `SKIP` sentinel for filter semantics or want to fuse transforms into a single derived store.

### Fan-out (10 subscribers)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **4.4M** | 22.7ms |
| Preact Signals | 3.6M | 27.4ms |

Comparable. Both iterate through subscriber collections and invoke callbacks. Recharge's Set-based sinks are slightly faster than Preact's linked-list effect chain.

### Memory per store (10,000 stores)

| Library | bytes/store | heap delta |
|---|---|---|
| Preact Signals | **118 bytes** | 1,156 KB |
| callbag-recharge | 3,603 bytes | 35,190 KB |

Preact signals are highly optimized class instances. Recharge stores are plain objects with a `Set` for sinks plus a `WeakRef` registration in the Inspector. Disabling the Inspector (`Inspector.enabled = false`) eliminates WeakRef/WeakMap overhead for production builds.

---

## Optimization benchmarks

These benchmarks compare the optimization APIs against their unoptimized equivalents.

### Inspector disabled vs enabled (store creation)

| Variant | ops/sec | time (10K ops) |
|---|---|---|
| Inspector OFF | **400K** | 25.0ms |
| Inspector ON (default) | 317K | 31.5ms |

Disabling the Inspector skips `WeakRef` creation and `WeakMap` registration. Set `Inspector.enabled = false` in production.

### batch() — 10 set() calls with effect

| Variant | ops/sec | time (10K ops) |
|---|---|---|
| **Batched** | **809K** | 12.4ms |
| Unbatched | 480K | 20.8ms |

`batch()` coalesces DIRTY propagation so effects run only once after all state changes. **1.7x faster** for multi-set scenarios. Nested batches are supported — effects flush only when the outermost batch completes.

### pipeRaw vs pipe (3 operators)

| Variant | ops/sec | time (100K ops) |
|---|---|---|
| pipe | **27M** | 3.7ms |
| pipeRaw | 6M | 16.6ms |

`pipe` operators are individual `derived` stores — lightweight with explicit deps. `pipeRaw` fuses all transforms into a single derived store, avoiding per-step Inspector registration and sinks Set allocation. Use `pipeRaw` when you need the `SKIP` sentinel for filter semantics or want to minimize store count.

### equals on diamond intermediates

| Variant | ops/sec | time (100K ops) |
|---|---|---|
| Without equals | 3.6M | 28.1ms |
| With equals | 3.4M | 29.2ms |

The `equals` option on derived stores adds a comparison check on pull. For this benchmark (simple integer clamping), the overhead is negligible. The benefit appears in real scenarios where intermediate values stabilize (e.g., rounding, clamping, enum mapping) — downstream effects/subscribers are skipped entirely when `equals` returns true.

---

## Bundle size

| Entry | ESM | CJS |
|---|---|---|
| `callbag-recharge` (core) | 1.12 KB | 4.02 KB |

The `map`, `filter`, and `scan` operators moved to `callbag-recharge/extra`, reducing the core entry point. All operators and extras are tree-shakeable — unused imports are eliminated by bundlers.

---

## Where callbag-recharge wins

- **State read/write** — plain objects are faster than class instances for simple operations
- **Computed reads** — 4x faster than Preact after dep change, 1.5x faster even for unchanged deps (no tracking context overhead)
- **Diamond patterns** — 4x faster than Preact due to pure-pull `get()` with no per-call wiring
- **Producer emit** — ~1.3x faster than Preact signal writes with subscribers, thanks to lightweight callbag sink iteration
- **Operator transform** — ~1.5x faster than Preact computed with subscribers, using handler-based dispatch
- **Fan-out** — ~1.2x faster than Preact for 10 subscribers
- **Inspectability** — neither Preact Signals nor raw Callbag offer `Inspector.graph()` or per-step readability in pipelines
- **Batching** — explicit `batch()` gives 1.7x speedup for multi-set patterns

## Where Preact Signals wins

- **Effects** — ~1.4x faster for effect re-runs (lighter scheduling overhead)
- **Memory** — ~30x smaller per store (mitigated by disabling Inspector in production)

## Where raw Callbag wins

- **Pipe throughput** — 2.5x faster than recharge `pipe` because operators are just nested function calls with no store overhead

---

## Perspective

All numbers are in the **millions of operations per second**. For context:

- A typical UI re-renders at 60fps = 16ms per frame
- At 3.4M ops/sec (our slowest benchmark, equals diamond), you can perform **54,400 reactive operations per frame**
- Most applications have dozens to hundreds of reactive nodes, not thousands

The performance gaps matter for:
- Libraries building on top of callbag-recharge
- Applications with thousands of derived nodes reading on every frame
- High-frequency data streaming (use `pipeRaw` or raw callbag pipes)

For typical application development, all three libraries are more than fast enough. callbag-recharge's value proposition is **inspectability + unified push/pull + correctness** at a performance level that is competitive with or exceeds Preact Signals in most benchmarks.

---

## Reproducing

```bash
npm install
npx tsx bench-compare.ts
```
