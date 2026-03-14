# Benchmarks

Comparative benchmarks against [@preact/signals-core](https://github.com/preactjs/signals) (the most widely used signals implementation) and raw [callbag](https://github.com/callbag/callbag) utilities.

All benchmarks run 100,000 iterations after 1,000 warmup iterations on Node.js. Hardware variations will shift absolute numbers, but relative comparisons hold.

---

## Results

### State read

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **173M** | 0.6ms |
| Preact Signals | 123M | 0.8ms |

Plain-object stores with a simple `.get()` method are faster than Preact's class-based signal instances. The explicit deps refactor removed `registerRead()` from `.get()`, making reads even cheaper.

### State write (no subscribers)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **40M** | 2.5ms |
| Preact Signals | 36M | 2.8ms |

Both perform an `Object.is` check and update. Recharge wins slightly because `pushDirty()` on an empty sinks set is a no-op. Custom `equals` functions are supported for structural equality.

### Computed read after dependency change

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **65M** | 1.5ms |
| Preact Signals | 17M | 6.0ms |

With explicit deps, `get()` is a pure pull — just calls `fn()` with no tracking context setup, no Set allocation, and no dependency diffing. Recharge is now ~4x faster than Preact for computed reads after a dep change.

### Computed read (unchanged dependencies)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge (recomputes)** | **175M** | 0.6ms |
| Preact Signals (cached) | 94M | 1.1ms |

With the tracking context removed, `get()` is now just a function call — even without caching, it's nearly 2x faster than Preact's cached flag check. Providing `equals` on a derived store enables pull-phase caching that skips downstream updates when the output hasn't changed.

### Diamond (A→B, A→C, B+C→D) write + read

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **40M** | 2.5ms |
| Preact Signals | 10M | 10.0ms |

Both produce correct, glitch-free results. Recharge is now ~4x faster than Preact because explicit deps eliminated per-pull dependency re-discovery and reconnection overhead. Adding `equals` to intermediate derived stores can further reduce unnecessary downstream propagation.

### Effect re-run

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **15M** | 6.5ms |
| Preact Signals | 14M | 7.2ms |

With static deps (connect once on creation, no reconnection per re-run), effects are now competitive with Preact. The remaining overhead is the enqueue/flush cycle for batched execution. Use `batch()` to coalesce multiple state changes into a single effect run.

### Pipe (3 operators) push through

| Library | ops/sec | time (100K ops) |
|---|---|---|
| raw Callbag | **101M** | 1.0ms |
| callbag-recharge `pipe` | 47M | 2.1ms |
| callbag-recharge `pipeRaw` | 22M | 4.5ms |

Raw callbag operators are nested function calls with zero allocation. Recharge `pipe` operators are `derived` stores — but without the tracking context overhead, each step is much cheaper than before. `pipe` is now faster than `pipeRaw` for this benchmark because `pipeRaw` fuses transforms into a single derived store (avoiding per-step overhead), while `pipe`'s per-step derived stores are now so lightweight that the indirection cost is minimal.

### Fan-out (10 subscribers)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| Preact Signals | **3.2M** | 30.8ms |
| callbag-recharge | 2.9M | 35.1ms |

Comparable. Both iterate through subscriber collections and invoke callbacks.

### Memory per store (10,000 stores)

| Library | bytes/store | heap delta |
|---|---|---|
| Preact Signals | **120 bytes** | 1,176 KB |
| callbag-recharge | 723 bytes | 7,060 KB |

Preact signals are highly optimized class instances. Recharge stores are plain objects with a `Set` for sinks plus a `WeakRef` registration in the Inspector. Disabling the Inspector (`Inspector.enabled = false`) eliminates WeakRef/WeakMap overhead for production builds. Memory per store dropped slightly (~2%) after removing the tracking-related fields (`currentDeps` Set, `sameSet()` function).

---

## Optimization benchmarks

These benchmarks compare the optimization APIs against their unoptimized equivalents.

### Inspector disabled vs enabled (store creation)

| Variant | ops/sec | time (10K ops) |
|---|---|---|
| Inspector OFF | **8.9M** | 1.1ms |
| Inspector ON (default) | 1.3M | 7.4ms |

Disabling the Inspector skips `WeakRef` creation and `WeakMap` registration, yielding a **6.8x speedup** for store creation. Set `Inspector.enabled = false` in production.

### batch() — 10 set() calls with effect

| Variant | ops/sec | time (10K ops) |
|---|---|---|
| **Batched** | **2.9M** | 3.4ms |
| Unbatched | 883K | 11.3ms |

`batch()` coalesces DIRTY propagation so effects run only once after all state changes. **3.3x faster** for multi-set scenarios. Nested batches are supported — effects flush only when the outermost batch completes.

### pipeRaw vs pipe (3 operators)

| Variant | ops/sec | time (100K ops) |
|---|---|---|
| pipe | **24M** | 4.1ms |
| pipeRaw | 22M | 4.5ms |

With explicit deps, `pipe` operators are lightweight enough that the per-step overhead is minimal. `pipeRaw` still avoids per-step Inspector registration and sinks Set allocation, but the gap has narrowed significantly. Use `pipeRaw` when you need the `SKIP` sentinel for filter semantics or want to minimize store count.

### equals on diamond intermediates

| Variant | ops/sec | time (100K ops) |
|---|---|---|
| With equals | **10M** | 10.0ms |
| Without equals | 9.9M | 10.1ms |

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
- **Computed reads** — 4x faster than Preact after dep change, 2x faster even for unchanged deps (no tracking context overhead)
- **Diamond patterns** — 4x faster than Preact due to pure-pull `get()` with no per-call wiring
- **Effects** — on par with Preact thanks to static deps (connect once, no reconnection)
- **Simplicity** — no dirty flags, no version counters, no implicit tracking, no topological sort — the lazy pull model gets correctness for free
- **Inspectability** — neither Preact Signals nor raw Callbag offer `Inspector.graph()` or per-step readability in pipelines
- **Batching** — explicit `batch()` gives 3.3x speedup for multi-set patterns

## Where Preact Signals wins

- **Fan-out** — slightly faster for 10+ subscribers (~10% gap)
- **Memory** — 6x smaller per store (mitigated by disabling Inspector in production)

## Where raw Callbag wins

- **Pipe throughput** — 2x faster than recharge `pipe` because operators are just nested function calls with no store overhead

---

## Perspective

All numbers are in the **millions of operations per second**. For context:

- A typical UI re-renders at 60fps = 16ms per frame
- At 2.9M ops/sec (our slowest benchmark, fan-out), you can perform **46,400 reactive operations per frame**
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
