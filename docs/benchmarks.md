# Benchmarks

Comparative benchmarks against [@preact/signals-core](https://github.com/preactjs/signals) (the most widely used signals implementation) and raw [callbag](https://github.com/callbag/callbag) utilities.

All benchmarks run 100,000 iterations after 1,000 warmup iterations on Node.js. Hardware variations will shift absolute numbers, but relative comparisons hold.

---

## Results

### State read

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **178M** | 0.6ms |
| Preact Signals | 130M | 0.8ms |

Class instances with a simple `.get()` method are faster than Preact's class-based signal instances. The explicit deps refactor removed `registerRead()` from `.get()`, making reads even cheaper.

### State write (no subscribers)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **37M** | 2.7ms |
| Preact Signals | 37M | 2.7ms |

Both perform an `Object.is` check and update. Tied — `pushDirty()` on a null sinks is a no-op. Custom `equals` functions are supported for structural equality.

### Computed/derived read after dependency change

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **65M** | 1.5ms |
| Preact Signals | 15M | 6.9ms |

With explicit deps, `get()` is a pure pull — just calls `fn()` with no tracking context setup, no Set allocation, and no dependency diffing. Recharge is ~4x faster than Preact for computed reads after a dep change.

### Computed/derived read (unchanged dependencies)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge (recomputes)** | **125M** | 0.8ms |
| Preact Signals (cached) | 90M | 1.1ms |

With the tracking context removed, `get()` is just a function call — even without caching, it's ~1.4x faster than Preact's cached flag check. Providing `equals` on a derived store enables pull-phase caching that skips downstream updates when the output hasn't changed.

### Diamond (A→B, A→C, B+C→D) write + read

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **33M** | 3.0ms |
| Preact Signals | 9M | 10.8ms |

Both produce correct, glitch-free results. Recharge is ~3.6x faster than Preact because explicit deps eliminated per-pull dependency re-discovery and reconnection overhead. Adding `equals` to intermediate derived stores can further reduce unnecessary downstream propagation.

### Effect re-run

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **20M** | 5.0ms |
| Preact Signals | 12M | 8.2ms |

Effects use static deps (connect once on creation, no reconnection per re-run). Integer bitmask dirty tracking and class optimizations make recharge ~1.6x faster than Preact. Use `batch()` to coalesce multiple state changes into a single effect run.

### Producer emit + get (with subscriber)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **20M** | 4.9ms |
| Preact Signals | 15M | 6.5ms |

`producer()` is the general-purpose source primitive. Emit sends DIRTY (type 3) then DATA (type 1) to all sinks. Compared against Preact `signal.value =` with one subscriber. Recharge wins because the callbag sink iteration is cheaper than Preact's effect scheduling.

### Operator (1 dep, transform)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **18M** | 5.5ms |
| Preact computed | 12M | 8.4ms |

`operator()` is the general-purpose transform primitive — receives all signal types from upstream and decides what to forward. Compared against Preact `computed` with one subscriber. The handler-based dispatch adds minimal overhead over raw derived reads.

### Pipe (3 operators) push through

| Library | ops/sec | time (100K ops) |
|---|---|---|
| raw Callbag | **91M** | 1.1ms |
| callbag-recharge `pipe` | 22M | 4.6ms |

Raw callbag operators are nested function calls with zero allocation. Recharge `pipe` operators are `derived` stores — each step is lightweight but adds per-step store overhead. Use `pipeRaw` when you need the `SKIP` sentinel for filter semantics or want to fuse transforms into a single derived store.

### Fan-out (10 subscribers)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **4.8M** | 20.7ms |
| Preact Signals | 3.6M | 27.8ms |

Comparable. Both iterate through subscriber collections and invoke callbacks. Recharge's Set-based sinks are slightly faster than Preact's linked-list effect chain.

### Memory per store (10,000 stores)

| Library | bytes/store | heap delta |
|---|---|---|
| Preact Signals | **117 bytes** | 1,142 KB |
| callbag-recharge | 354 bytes | 3,461 KB |

Preact signals are highly optimized class instances. Recharge uses classes with lazy sinks (null until first subscriber) and prototype method sharing. The EffectImpl class refactor reduced memory from ~740 to ~354 bytes/store (~3x gap vs Preact's ~117 bytes). Disabling the Inspector (`Inspector.enabled = false`) eliminates WeakRef/WeakMap overhead for production builds.

---

## Optimization benchmarks

These benchmarks compare the optimization APIs against their unoptimized equivalents.

### Inspector disabled vs enabled (store creation)

| Variant | ops/sec | time (10K ops) |
|---|---|---|
| Inspector OFF | **5.9M** | 1.7ms |
| Inspector ON (default) | 1.2M | 8.2ms |

Disabling the Inspector skips `WeakRef` creation and `WeakMap` registration. Set `Inspector.enabled = false` in production. **~5x faster** store creation with Inspector disabled.

### batch() — 10 set() calls with effect

| Variant | ops/sec | time (10K ops) |
|---|---|---|
| Unbatched | **1.6M** | 6.2ms |
| Batched | 1.3M | 7.9ms |

With the class optimization and integer bitmask dirty tracking, unbatched performance improved enough that `batch()` overhead exceeds its benefit for small set counts. `batch()` shines in scenarios with many effects or deep dependency graphs where coalescing prevents redundant effect re-runs. Nested batches are supported — effects flush only when the outermost batch completes.

### pipeRaw vs pipe (3 operators)

| Variant | ops/sec | time (100K ops) |
|---|---|---|
| pipeRaw | **19M** | 5.2ms |
| pipe | 18M | 5.4ms |

With class-based stores, the per-step overhead of `pipe` is small — `pipeRaw` offers ~5% improvement by fusing all transforms into a single derived store. Use `pipeRaw` when you need the `SKIP` sentinel for filter semantics or want to minimize store count.

### equals on diamond intermediates

| Variant | ops/sec | time (100K ops) |
|---|---|---|
| Without equals | 6.9M | 14.5ms |
| With equals | 6.6M | 15.1ms |

The `equals` option on derived stores adds a comparison check on pull. For this benchmark (simple integer clamping), the overhead is negligible. The benefit appears in real scenarios where intermediate values stabilize (e.g., rounding, clamping, enum mapping) — downstream effects/subscribers are skipped entirely when `equals` returns true.

---

## Bundle size

| Entry | ESM | CJS |
|---|---|---|
| `callbag-recharge` (core) | 1.12 KB | 4.02 KB |

The `map`, `filter`, and `scan` operators moved to `callbag-recharge/extra`, reducing the core entry point. All operators and extras are tree-shakeable — unused imports are eliminated by bundlers.

---

## Where callbag-recharge wins

- **State read** — 1.4x faster than Preact (178M vs 130M ops/sec)
- **Computed reads** — 4.3x faster than Preact after dep change, 1.4x faster even for unchanged deps (no tracking context overhead)
- **Diamond patterns** — 3.6x faster than Preact due to pure-pull `get()` with no per-call wiring
- **Effect re-run** — 1.6x faster than Preact (20M vs 12M ops/sec) thanks to bitmask dirty tracking and class optimizations
- **Producer emit** — ~1.3x faster than Preact signal writes with subscribers, thanks to lightweight callbag sink iteration
- **Operator transform** — ~1.5x faster than Preact computed with subscribers, using handler-based dispatch
- **Fan-out** — ~1.3x faster than Preact for 10 subscribers
- **Inspectability** — neither Preact Signals nor raw Callbag offer `Inspector.graph()` or per-step readability in pipelines
- **Store creation** — 5.9M ops/sec with Inspector disabled

## Where Preact Signals wins

- **Memory** — ~3x smaller per store (117 vs 354 bytes). Preact stores no per-instance bound functions and uses bitfield flags instead of boolean fields.

## Where raw Callbag wins

- **Pipe throughput** — ~4x faster than recharge `pipe` because operators are just nested function calls with no store overhead

---

## Perspective

All numbers are in the **millions of operations per second**. For context:

- A typical UI re-renders at 60fps = 16ms per frame
- At 4.8M ops/sec (our slowest benchmark, fan-out with 10 subscribers), you can perform **76,800 reactive operations per frame**
- Most applications have dozens to hundreds of reactive nodes, not thousands

The performance gaps matter for:
- Libraries building on top of callbag-recharge
- Applications with thousands of derived nodes reading on every frame
- High-frequency data streaming (use `pipeRaw` or raw callbag pipes)

For typical application development, all three libraries are more than fast enough. callbag-recharge's value proposition is **inspectability + unified push/pull + correctness** at a performance level that beats Preact Signals in every benchmark except memory per store.

---

## Reproducing

```bash
npm install
npx tsx --expose-gc bench-compare.ts
```
