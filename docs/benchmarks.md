# Benchmarks

Comparative benchmarks against [@preact/signals-core](https://github.com/preactjs/signals) (the most widely used signals implementation) and raw [callbag](https://github.com/callbag/callbag) utilities.

All benchmarks run 100,000 iterations after 1,000 warmup iterations on Node.js. Hardware variations will shift absolute numbers, but relative comparisons hold.

---

## Results

### State read

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **144M** | 0.7ms |
| Preact Signals | 134M | 0.7ms |

Plain-object stores with a simple `.get()` method are slightly faster than Preact's class-based signal instances.

### State write (no subscribers)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **42M** | 2.4ms |
| Preact Signals | 39M | 2.5ms |

Both perform an `Object.is` check and update. Recharge wins slightly because `pushDirty()` on an empty sinks set is a no-op. Custom `equals` functions are supported for structural equality.

### Computed read after dependency change

| Library | ops/sec | time (100K ops) |
|---|---|---|
| Preact Signals | **16M** | 6.2ms |
| callbag-recharge | 10M | 9.9ms |

Preact checks a dirty flag and recomputes only if needed. Recharge always recomputes (no cache by default). The 1.6x gap is the cost of unconditional function execution + tracking context setup. Providing an `equals` option enables conditional caching on derived stores.

### Computed read (unchanged dependencies)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| Preact Signals (cached) | **94M** | 1.1ms |
| callbag-recharge (recomputes) | 14M | 7.4ms |

This is the largest gap. Preact returns its cached value after a single flag check. Recharge runs the full computation function + tracking context every time. This is the deliberate no-cache tradeoff — providing `equals` on a derived store enables pull-phase caching that skips downstream updates when the output hasn't changed.

### Diamond (A→B, A→C, B+C→D) write + read

| Library | ops/sec | time (100K ops) |
|---|---|---|
| Preact Signals | **10M** | 10.1ms |
| callbag-recharge | 4M | 23.2ms |

Both produce correct, glitch-free results. Preact is faster because its cached computed nodes skip recomputation when a dependency's value didn't actually change. Recharge recomputes every derived node in the pull chain. Adding `equals` to intermediate derived stores can reduce unnecessary downstream propagation.

### Effect re-run

| Library | ops/sec | time (100K ops) |
|---|---|---|
| Preact Signals | **13M** | 7.5ms |
| callbag-recharge | 4M | 23.8ms |

Recharge effects go through more machinery: DIRTY propagation → enqueue → flush → tracked re-run → callbag reconnection. Preact's effect system is tightly integrated with its version-counter-based invalidation. Use `batch()` to coalesce multiple state changes into a single effect run.

### Pipe (3 operators) push through

| Library | ops/sec | time (100K ops) |
|---|---|---|
| raw Callbag | **94M** | 1.1ms |
| callbag-recharge `pipeRaw` | 11M | 9.6ms |
| callbag-recharge `pipe` | 5M | 19.3ms |

The largest relative gap. Raw callbag operators are nested function calls with zero allocation. Recharge `pipe` operators are `derived` stores — each step creates a tracking context, discovers dependencies, and potentially reconnects callbag sinks. `pipeRaw()` fuses all transforms into a single derived store, cutting overhead by ~2x compared to `pipe()`.

### Fan-out (10 subscribers)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| Preact Signals | **4M** | 27.2ms |
| callbag-recharge | 3M | 36.1ms |

Comparable. Both iterate through subscriber collections and invoke callbacks.

### Memory per store (10,000 stores)

| Library | bytes/store | heap delta |
|---|---|---|
| Preact Signals | **119 bytes** | 1,166 KB |
| callbag-recharge | 737 bytes | 7,201 KB |

Preact signals are highly optimized class instances. Recharge stores are plain objects with a `Set` for sinks plus a `WeakRef` registration in the Inspector. Disabling the Inspector (`Inspector.enabled = false`) eliminates WeakRef/WeakMap overhead for production builds.

---

## Optimization benchmarks

These benchmarks compare the new optimization APIs against their unoptimized equivalents.

### Inspector disabled vs enabled (store creation)

| Variant | ops/sec | time (10K ops) |
|---|---|---|
| Inspector OFF | **3.5M** | 2.9ms |
| Inspector ON (default) | 1.4M | 7.0ms |

Disabling the Inspector skips `WeakRef` creation and `WeakMap` registration, yielding a **2.5x speedup** for store creation. Set `Inspector.enabled = false` in production.

### batch() — 10 set() calls with effect

| Variant | ops/sec | time (10K ops) |
|---|---|---|
| **Batched** | **855K** | 11.7ms |
| Unbatched | 102K | 98.5ms |

`batch()` coalesces DIRTY propagation so effects run only once after all state changes. **8.4x faster** for multi-set scenarios. Nested batches are supported — effects flush only when the outermost batch completes.

### pipeRaw vs pipe (3 operators)

| Variant | ops/sec | time (100K ops) |
|---|---|---|
| **pipeRaw** | **11M** | 9.6ms |
| pipe | 5M | 20.3ms |

`pipeRaw()` fuses all transform functions into a single `derived()` store instead of creating one per operator. **2x faster** throughput. Supports `SKIP` sentinel for filter semantics.

### equals on diamond intermediates

| Variant | ops/sec | time (100K ops) |
|---|---|---|
| Without equals | 2.6M | 38.8ms |
| With equals | 2.1M | 48.7ms |

The `equals` option on derived stores adds a comparison check on pull. For this benchmark (simple integer clamping), the overhead of the comparison outweighs the savings since every change propagates anyway. The benefit appears in real scenarios where intermediate values stabilize (e.g., rounding, clamping, enum mapping) — downstream effects/subscribers are skipped entirely when `equals` returns true.

---

## Bundle size

| Entry | ESM | CJS |
|---|---|---|
| `callbag-recharge` (core) | 1.56 KB | 4.63 KB |

The 4 optimization additions (`batch`, `pipeRaw`, `SKIP`, `equals` option, `Inspector.enabled`) added ~200 bytes to the ESM entry point and ~620 bytes to CJS (15% increase). All new APIs are tree-shakeable — unused imports are eliminated by bundlers.

---

## Where callbag-recharge wins

- **State read/write** — plain objects are faster than class instances for simple operations
- **Simplicity** — no dirty flags, no version counters, no topological sort — the lazy pull model gets correctness for free
- **Inspectability** — neither Preact Signals nor raw Callbag offer `Inspector.graph()` or per-step readability in pipelines
- **Batching** — explicit `batch()` gives 8x speedup for multi-set patterns

## Where Preact Signals wins

- **Cached computed reads** — 7x faster when dependencies haven't changed (Recharge recomputes by design; use `equals` for pull-phase caching)
- **Diamond patterns** — 2.5x faster due to caching skipping unnecessary recomputation
- **Effects** — 3x faster due to tighter integration with the invalidation system
- **Memory** — 6x smaller per store (mitigated by disabling Inspector in production)

## Where raw Callbag wins

- **Pipe throughput** — 9x faster than `pipeRaw`, 18x faster than `pipe` because operators are just nested function calls with no store overhead

---

## Perspective

All numbers are in the **millions of operations per second**. For context:

- A typical UI re-renders at 60fps = 16ms per frame
- At 4M ops/sec (our slowest), you can perform **64,000 reactive operations per frame**
- Most applications have dozens to hundreds of reactive nodes, not thousands

The performance gaps matter for:
- Libraries building on top of callbag-recharge
- Applications with thousands of derived nodes reading on every frame
- High-frequency data streaming (use `pipeRaw` or raw callbag pipes)

For typical application development, all three libraries are more than fast enough. callbag-recharge's value proposition is not raw speed — it's **inspectability + unified push/pull + correctness** at a performance level that never becomes a bottleneck in practice. The new optimization APIs (`batch`, `pipeRaw`, `equals`, `Inspector.enabled`) close the most impactful gaps for performance-sensitive paths.

---

## Reproducing

```bash
npm install
npx tsx bench-compare.ts
```
