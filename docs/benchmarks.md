# Benchmarks

Comparative benchmarks against [@preact/signals-core](https://github.com/preactjs/signals) (the most widely used signals implementation) and raw [callbag](https://github.com/callbag/callbag) utilities.

All benchmarks run 100,000 iterations after 1,000 warmup iterations on Node.js. Hardware variations will shift absolute numbers, but relative comparisons hold.

---

## Results

### State read

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **168M** | 0.6ms |
| Preact Signals | 115M | 0.9ms |

Class instances with a simple `.get()` method are faster than Preact's class-based signal instances. Explicit deps mean `get()` has no `registerRead()` overhead.

### State write (no subscribers)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| Preact Signals | 34M | 2.9ms |
| callbag-recharge | 9.8M | 10.2ms |

Preact's write path is simpler — no output slot dispatch. Recharge's `set()` goes through the `equals` guard plus output slot DIRTY dispatch to a null output. The gap reflects the cost of the two-phase push protocol even when no subscribers are listening.

### Computed/derived read after dependency change

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **12.8M** | 7.8ms |
| Preact Signals | 7.3M | 13.8ms |

With STANDALONE mode, derived nodes eagerly connect at construction and stay connected. On dep change, DIRTY propagates via the output slot, followed by DATA with the recomputed value. Recharge is ~1.8x faster than Preact.

### Computed/derived read (unchanged dependencies)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **232M** | 0.4ms |
| Preact Signals | 85M | 1.2ms |

STANDALONE derived nodes cache their last computed value. `get()` returns the cache directly — no recompute, no flag check. ~2.7x faster than Preact's cached flag check. Providing `equals` on a derived store enables push-phase memoization that skips downstream updates when the output hasn't changed.

### Diamond (A->B, A->C, B+C->D) write + read

| Library | ops/sec | time (100K ops) |
|---|---|---|
| Preact Signals | **9.8M** | 10.2ms |
| callbag-recharge | 6.9M | 14.4ms |

Both produce correct, glitch-free results. Derived nodes are STANDALONE — each intermediate node maintains an active connection and output slot even without external subscribers. This adds overhead but ensures `get()` always returns a current value. Preact's simpler push-invalidate model wins here by ~1.4x. Adding `equals` to intermediate derived stores can reduce unnecessary downstream propagation.

### Effect re-run

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **20.3M** | 4.9ms |
| Preact Signals | 12.5M | 8.0ms |

Effects use static deps (connect once on creation, no reconnection per re-run). Integer bitmask dirty tracking and the pure closure implementation make recharge ~1.6x faster than Preact. Use `batch()` to coalesce multiple state changes into a single effect run.

### Producer emit + get (with subscriber)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **26.4M** | 3.8ms |
| Preact Signals | 15.7M | 6.4ms |

`producer()` is the general-purpose source primitive. Emit sends DIRTY (type 3) then DATA (type 1) through the output slot. Compared against Preact `signal.value =` with one subscriber. Recharge is ~1.7x faster because the output slot dispatch is cheaper than Preact's effect scheduling.

### Operator (1 dep, transform)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **24.4M** | 4.1ms |
| Preact Signals | 12.2M | 8.2ms |

`operator()` is the general-purpose transform primitive — receives all signal types from upstream deps and decides what to forward downstream. Compared against Preact `computed` with one subscriber. The handler-based dispatch is ~2x faster than Preact.

### Pipe (3 operators) push through

| Library | ops/sec | time (100K ops) |
|---|---|---|
| raw Callbag | **97M** | 1.0ms |
| callbag-recharge `pipe` | 21M | 4.8ms |

Raw callbag operators are nested function calls with zero allocation. Recharge `pipe` operators create `operator`/`derived` stores per step — each step is lightweight but adds per-step store overhead. Use `pipeRaw` when you need the `SKIP` sentinel for filter semantics or want to fuse transforms into a single derived store.

### Fan-out (10 subscribers)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **4.7M** | 21.5ms |
| Preact Signals | 3.6M | 27.8ms |

Comparable. Both iterate through subscriber collections and invoke callbacks. Recharge's output slot (Set-based in MULTI mode) is slightly faster than Preact's linked-list effect chain. ~1.3x faster.

### Memory per store (10,000 stores)

| Library | bytes/store | heap delta |
|---|---|---|
| Preact Signals | **121 bytes** | 1,182 KB |
| callbag-recharge | 719 bytes | 7,021 KB |

Preact signals are highly optimized class instances with no per-instance bound functions and bitfield flags. Recharge uses STANDALONE derived nodes that eagerly connect at construction, maintaining active output slots and talkback references even without external subscribers. The output slot model, handler closure assembly, and Inspector registration (WeakRef/WeakMap) contribute to the per-store overhead. Disabling the Inspector (`Inspector.enabled = false`) reduces allocation on creation but does not eliminate the structural cost of STANDALONE connections.

---

## Optimization benchmarks

These benchmarks compare the optimization APIs against their unoptimized equivalents.

### Inspector disabled vs enabled (store creation)

| Variant | ops/sec | time (10K ops) |
|---|---|---|
| Inspector OFF | **7.3M** | 1.4ms |
| Inspector ON (default) | 1.3M | 7.9ms |

Disabling the Inspector skips `WeakRef` creation and `WeakMap` registration. Set `Inspector.enabled = false` in production. **~5.6x faster** store creation with Inspector disabled.

### batch() — 10 set() calls with effect

| Variant | ops/sec | time (10K ops) |
|---|---|---|
| Unbatched | **1.5M** | 6.5ms |
| Batched | 1.3M | 7.5ms |

With integer bitmask dirty tracking and the pure closure effect implementation, unbatched performance is competitive. `batch()` overhead exceeds its benefit for small set counts with a single effect. `batch()` shines in scenarios with many effects or deep dependency graphs where coalescing prevents redundant effect re-runs. Nested batches are supported — effects flush only when the outermost batch completes.

### pipeRaw vs pipe (3 operators)

| Variant | ops/sec | time (100K ops) |
|---|---|---|
| pipe | **17M** | 5.9ms |
| pipeRaw | 16.7M | 6.0ms |

With optimized operator internals, `pipe` and `pipeRaw` perform roughly the same. `pipeRaw` fuses all transforms into a single `operator` store, eliminating intermediate nodes — the benefit is reduced store count and memory, not throughput. Use `pipeRaw` when you need the `SKIP` sentinel for filter semantics or want to minimize store allocations.

### equals on diamond intermediates

| Variant | ops/sec | time (100K ops) |
|---|---|---|
| Without equals | 7.5M | 13.3ms |
| With equals | 7.0M | 14.4ms |

The `equals` option on derived stores adds a comparison check on pull. For this benchmark (simple integer clamping), the overhead is negligible. The benefit appears in real scenarios where intermediate values stabilize (e.g., rounding, clamping, enum mapping) — downstream effects/subscribers are skipped entirely when `equals` returns true and RESOLVED propagates instead of DATA.

---

## Bundle size

| Entry | ESM | CJS |
|---|---|---|
| `callbag-recharge` (core) | 1.12 KB | 4.02 KB |

The `map`, `filter`, and `scan` operators moved to `callbag-recharge/extra`, reducing the core entry point. All operators and extras are tree-shakeable — unused imports are eliminated by bundlers.

---

## Where callbag-recharge wins

- **State read** — 1.5x faster than Preact (168M vs 115M ops/sec)
- **Computed reads (unchanged deps)** — 2.7x faster than Preact (232M vs 85M ops/sec) — STANDALONE cache returns directly
- **Computed reads (after dep change)** — 1.8x faster than Preact (12.8M vs 7.3M ops/sec)
- **Effect re-run** — 1.6x faster than Preact (20.3M vs 12.5M ops/sec) thanks to bitmask dirty tracking and pure closure
- **Producer emit** — 1.7x faster than Preact (26.4M vs 15.7M ops/sec) thanks to lightweight output slot dispatch
- **Operator transform** — 2x faster than Preact (24.4M vs 12.2M ops/sec) using handler-based dispatch
- **Fan-out** — 1.3x faster than Preact for 10 subscribers (4.7M vs 3.6M ops/sec)
- **Inspectability** — neither Preact Signals nor raw Callbag offer `Inspector.graph()`, status tracking, or per-step readability in pipelines
- **Store creation** — 7.3M ops/sec with Inspector disabled (~5.6x faster than enabled)

## Where Preact Signals wins

- **State write (no subscribers)** — 3.5x faster (34M vs 9.8M ops/sec). Recharge's two-phase push protocol (equals guard + output slot DIRTY dispatch) adds overhead even when no subscribers are listening.
- **Diamond patterns** — 1.4x faster (9.8M vs 6.9M ops/sec). STANDALONE mode maintains active connections in intermediate derived nodes, adding overhead that Preact's simpler push-invalidate model avoids.
- **Memory** — ~6x smaller per store (121 vs 719 bytes). Preact stores no per-instance bound functions and uses bitfield flags. Recharge's STANDALONE connections, output slot model, and handler closures add per-node cost.

## Where raw Callbag wins

- **Pipe throughput** — ~4.6x faster than recharge `pipe` because operators are just nested function calls with no store overhead

---

## Perspective

All numbers are in the **millions of operations per second**. For context:

- A typical UI re-renders at 60fps = 16ms per frame
- At 4.7M ops/sec (our slowest benchmark, fan-out with 10 subscribers), you can perform **75,200 reactive operations per frame**
- Most applications have dozens to hundreds of reactive nodes, not thousands

The performance gaps matter for:
- Libraries building on top of callbag-recharge
- Applications with thousands of derived nodes reading on every frame
- High-frequency data streaming (use `pipeRaw` or raw callbag pipes)

For typical application development, all three libraries are more than fast enough. callbag-recharge's value proposition is **inspectability + unified push/pull + correctness** at a performance level that beats Preact Signals in most benchmarks.

---

## Reproducing

```bash
npm install
npx tsx --expose-gc bench-compare.ts
```
