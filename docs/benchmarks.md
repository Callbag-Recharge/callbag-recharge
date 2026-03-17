# Benchmarks

Comparative benchmarks against [@preact/signals-core](https://github.com/preactjs/signals) (the most widely used signals implementation) and raw [callbag](https://github.com/callbag/callbag) utilities.

All benchmarks run 100,000 iterations after 1,000 warmup iterations on Node.js. Hardware variations will shift absolute numbers, but relative comparisons hold.

---

## Results

### State read

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **175M** | 0.6ms |
| Preact Signals | 115M | 0.9ms |

Class instances with a simple `.get()` method are faster than Preact's class-based signal instances. Explicit deps mean `get()` has no `registerRead()` overhead.

### State write (no subscribers)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **47M** | 2.1ms |
| Preact Signals | 35M | 2.9ms |

`StateImpl.set()` inlines the `emit()` logic (v4.1 fast path). For the no-subscriber case (`_output === null`), `set()` is just an `Object.is` check + `_value` assignment — no DIRTY/DATA dispatch. Recharge is now ~1.3x faster than Preact.

### Computed/derived read after dependency change

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **16M** | 6.3ms |
| Preact Signals | 15M | 6.6ms |

Derived nodes use lazy STANDALONE — no computation or connection at construction. First `get()` triggers connection + compute. On dep change, DIRTY propagates via the output slot, followed by DATA with the recomputed value. Recharge is ~1.1x faster than Preact.

### Computed/derived read (unchanged dependencies)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **208M** | 0.5ms |
| Preact Signals | 87M | 1.2ms |

Lazy STANDALONE derived nodes cache their last computed value. `get()` returns the cache after a single flag check — no recompute. ~2.4x faster than Preact's cached flag check. Providing `equals` on a derived store enables push-phase memoization that skips downstream updates when the output hasn't changed.

### Diamond (A->B, A->C, B+C->D) write + read

| Library | ops/sec | time (100K ops) |
|---|---|---|
| Preact Signals | **10M** | 10.0ms |
| callbag-recharge | 7.2M | 14.0ms |

Both produce correct, glitch-free results. Derived nodes use lazy STANDALONE — intermediate nodes maintain active connections after first `get()`, ensuring cached values stay current. Preact's simpler push-invalidate model wins here by ~1.4x. Adding `equals` to intermediate derived stores can reduce unnecessary downstream propagation.

### Effect re-run

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **26M** | 3.8ms |
| Preact Signals | 13.5M | 7.4ms |

Effects use static deps (connect once on creation, no reconnection per re-run). Integer bitmask dirty tracking and the pure closure implementation make recharge ~1.9x faster than Preact. Use `batch()` to coalesce multiple state changes into a single effect run.

### Producer emit + get (with subscriber)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **29M** | 3.5ms |
| Preact Signals | 16.5M | 6.1ms |

`producer()` is the general-purpose source primitive. Emit sends DIRTY (type 3) then DATA (type 1) through the output slot. Compared against Preact `signal.value =` with one subscriber. Recharge is ~1.8x faster because the output slot dispatch is cheaper than Preact's effect scheduling.

### Operator (1 dep, transform)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **25M** | 4.0ms |
| Preact Signals | 12.4M | 8.1ms |

`operator()` is the general-purpose transform primitive — receives all signal types from upstream deps and decides what to forward downstream. Compared against Preact `computed` with one subscriber. The handler-based dispatch is ~2x faster than Preact.

### Pipe (3 operators) push through

| Library | ops/sec | time (100K ops) |
|---|---|---|
| raw Callbag | **103M** | 1.0ms |
| callbag-recharge `pipe` | 23M | 4.3ms |

Raw callbag operators are nested function calls with zero allocation. Recharge `pipe` operators create `operator`/`derived` stores per step — each step is lightweight but adds per-step store overhead. Use `pipeRaw` when you need the `SKIP` sentinel for filter semantics or want to fuse transforms into a single derived store.

### Fan-out (10 subscribers)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **4.7M** | 21.3ms |
| Preact Signals | 3.4M | 29.4ms |

Comparable. Both iterate through subscriber collections and invoke callbacks. Recharge's output slot (Set-based in MULTI mode) is slightly faster than Preact's linked-list effect chain. ~1.4x faster.

### Memory per store (10,000 stores)

| Library | bytes/store | heap delta |
|---|---|---|
| Preact Signals | **122 bytes** | 1,193 KB |
| callbag-recharge | 719 bytes | 7,021 KB |

Preact signals are highly optimized class instances with no per-instance bound functions and bitfield flags. Recharge's per-store cost comes from the output slot model, handler closure assembly, bound methods, and Inspector registration (WeakRef/WeakMap). Lazy STANDALONE means derived nodes defer connection until first use, but once connected they maintain talkback references and output slots. Disabling the Inspector (`Inspector.enabled = false`) reduces allocation on creation but does not eliminate the structural cost of active connections.

---

## Optimization benchmarks

These benchmarks compare the optimization APIs against their unoptimized equivalents.

### Inspector disabled vs enabled (store creation)

| Variant | ops/sec | time (10K ops) |
|---|---|---|
| Inspector OFF | **6.6M** | 1.5ms |
| Inspector ON (default) | 1.1M | 9.1ms |

Disabling the Inspector skips `WeakRef` creation and `WeakMap` registration. Set `Inspector.enabled = false` in production. **~6x faster** store creation with Inspector disabled.

### batch() — 10 set() calls with effect

| Variant | ops/sec | time (10K ops) |
|---|---|---|
| Batched | **1.4M** | 7.3ms |
| Unbatched | 1.3M | 8.1ms |

With the state write fast path, `batch()` now edges ahead even for small set counts. DIRTY propagates immediately while DATA emission is deferred, so the effect runs exactly once instead of 10 times. `batch()` shines more in scenarios with many effects or deep dependency graphs where coalescing prevents redundant effect re-runs. Nested batches are supported — effects flush only when the outermost batch completes.

### pipeRaw vs pipe (3 operators)

| Variant | ops/sec | time (100K ops) |
|---|---|---|
| pipe | **18M** | 5.5ms |
| pipeRaw | 18M | 5.6ms |

With optimized operator internals, `pipe` and `pipeRaw` perform roughly the same. `pipeRaw` fuses all transforms into a single `operator` store, eliminating intermediate nodes — the benefit is reduced store count and memory, not throughput. Use `pipeRaw` when you need the `SKIP` sentinel for filter semantics or want to minimize store allocations.

### equals on diamond intermediates

| Variant | ops/sec | time (100K ops) |
|---|---|---|
| Without equals | 7.3M | 13.8ms |
| With equals | 6.7M | 15.0ms |

The `equals` option on derived stores adds a comparison check on pull. For this benchmark (simple integer clamping), the overhead is negligible. The benefit appears in real scenarios where intermediate values stabilize (e.g., rounding, clamping, enum mapping) — downstream effects/subscribers are skipped entirely when `equals` returns true and RESOLVED propagates instead of DATA.

---

## Bundle size

| Entry | ESM | CJS |
|---|---|---|
| `callbag-recharge` (core) | 1.12 KB | 4.02 KB |

The `map`, `filter`, and `scan` operators moved to `callbag-recharge/extra`, reducing the core entry point. All operators and extras are tree-shakeable — unused imports are eliminated by bundlers.

---

## Where callbag-recharge wins

- **State read** — 1.5x faster than Preact (175M vs 115M ops/sec)
- **State write (no subscribers)** — 1.3x faster than Preact (47M vs 35M ops/sec) thanks to `set()` fast path (inlined emit, no DIRTY dispatch when `_output === null`)
- **Computed reads (unchanged deps)** — 2.4x faster than Preact (208M vs 87M ops/sec) — lazy STANDALONE cache returns directly after a single flag check
- **Computed reads (after dep change)** — 1.1x faster than Preact (16M vs 15M ops/sec)
- **Effect re-run** — 1.9x faster than Preact (26M vs 13.5M ops/sec) thanks to bitmask dirty tracking and pure closure
- **Producer emit** — 1.8x faster than Preact (29M vs 16.5M ops/sec) thanks to lightweight output slot dispatch
- **Operator transform** — 2x faster than Preact (25M vs 12.4M ops/sec) using handler-based dispatch
- **Fan-out** — 1.4x faster than Preact for 10 subscribers (4.7M vs 3.4M ops/sec)
- **Inspectability** — neither Preact Signals nor raw Callbag offer `Inspector.graph()`, status tracking, or per-step readability in pipelines
- **Store creation** — 6.6M ops/sec with Inspector disabled (~6x faster than enabled)

## Where Preact Signals wins

- **Diamond patterns** — 1.4x faster (10M vs 7.2M ops/sec). Lazy STANDALONE maintains active connections in intermediate derived nodes after first access, adding overhead that Preact's simpler push-invalidate model avoids.
- **Memory** — ~6x smaller per store (122 vs 719 bytes). Preact stores no per-instance bound functions and uses bitfield flags. Recharge's output slot model, handler closures, and bound methods add per-node cost.

## Where raw Callbag wins

- **Pipe throughput** — ~4.5x faster than recharge `pipe` because operators are just nested function calls with no store overhead

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

For typical application development, all three libraries are more than fast enough. callbag-recharge's value proposition is **inspectability + unified push/pull + correctness** at a performance level that beats Preact Signals in every benchmark except diamond patterns and memory footprint.

---

## Reproducing

```bash
npm install
npx tsx --expose-gc bench-compare.ts
```
