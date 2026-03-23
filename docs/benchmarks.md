# Benchmarks

Self-comparison benchmarks tracking performance across graph shapes, plus **in-process algorithm baselines** for Level 3 data structures (`reactiveMap`, `reactiveLog`, `reactiveIndex`, eviction utils, `collection`).

## Running benchmarks (Vitest + tinybench)

All benchmarks run via **[Vitest bench](https://vitest.dev/guide/features.html#benchmarking)**, which uses **[tinybench](https://github.com/tinylibs/tinybench)** for timing, warmup, and statistical summaries (mean latency, throughput, relative "x faster than" within each `describe` group).

```bash
pnpm install
pnpm run bench              # full suite (core + data algorithms)
pnpm run bench:core         # core primitives, graph shapes, optimizations
pnpm run bench:data         # Level 3 vs plain JS baselines only
```

- **Tests** stay separate: `*.bench.ts` under `src/__bench__/` are excluded from `pnpm test` ([vitest.config.ts](../vitest.config.ts)).
- **Redis** is intentionally not part of these benchmarks (fair algorithm comparisons are in-process only).
- Absolute numbers vary by CPU and Node version; use relative comparisons within each group and re-run before/after architectural changes.
- **Inspector store-creation** benches use a short time window (~200ms) so each run does not allocate unbounded `state()` instances during tinybench sampling.

---

## Current results (2026-03-23 — Tinybench, v0.18.0)

Measured on Node v22+ using `vitest bench`. Hz = ops/sec. Post-D3 architecture (lazy Tier 2, derived disconnect-on-unsub). All numbers from a single consolidated bench file ([`src/__bench__/compare.bench.ts`](../src/__bench__/compare.bench.ts)).

| Scenario | Ops/sec (Hz) | Δ vs prev | Notes |
|---|---|---|---|
| **State read** | **33.3 M** | -3% | Hot path baseline (within noise) |
| **State write (no subs)** | **18.9 M** | — | Inlined `set()` fast path (stable) |
| **State write (with subscriber)** | **5.1 M** | *new* | Full DIRTY→DATA→subscriber cycle |
| **Derived read (changed deps)** | **21.5 M** | -7% | P0 single-dep recomputation |
| **Derived read (multi-dep)** | **19.8 M** | *new* | Set one dep + get with bitmask |
| **Derived read (cached)** | **29.3 M** | -14% | Connected-mode cache hit — see notes |
| **Diamond (A→B,C→D)** | **16.4 M** | — | Glitch-free, integer `_status` (stable) |
| **Diamond (5 levels deep)** | **11.2 M** | *new* | Deep chain propagation cost |
| **Diamond (10 wide)** | **8.4 M** | *new* | Wide fan-out convergence |
| **Effect re-run** | **6.7 M** | -3% | Mild regression from 6.9M (within noise) |
| **Effect multi-dep (diamond)** | **1.6 M** | *new* | Diamond + effect combined cost |
| **Producer emit + get** | **7.7 M** | **+5%** | Stream-to-store bridge, improved |
| **Operator (transform)** | **6.9 M** | **+6%** | Improved node handling |
| **Pipe (3 operators)** | **14.6 M** | **+8%** | Composed derived chain, improved |
| **Pipe (get only, cached)** | **17.8 M** | *new* | Pure cache-hit read through pipe |
| **Fan-out (10 subscribers)** | **1.4 M** | -22% | See notes below |
| **Fan-out (100 subscribers)** | **185 K** | *new* | Linear scaling with subscriber count |

### Changes since last measurement

**Improved:** Producer (+5%), pipe (+8%), and operator (+6%) show throughput gains — cumulative optimizations to the signal dispatch path and SINGLE_DEP skip logic are paying off.

**Regressed:** Derived cached read dropped 14% (34.0M → 29.3M). Fan-out (10 subs) dropped 22% (1.8M → 1.4M). Effect re-run is only -3% (6.9M → 6.7M) — the apparent -11% in the previous doc was from mixing core.bench and compare.bench numbers. Now that we have a single source of truth, the effect regression is within noise.

**Derived cached regression:** The 34.0M number came from the old `core.bench.ts` which used a different setup (multi-dep derived with `[a, b]`). The consolidated bench uses a single-dep derived — the difference is likely structural (single-dep fast path vs multi-dep), not a real regression. Worth verifying with a multi-dep cached bench if this matters.

**Fan-out regression:** The 1.8M number came from `core.bench.ts`; the consolidated bench shows 1.4M consistently. The bench setup is identical (10 `subscribe` calls). This may reflect V8 JIT variance across bench files — the consolidated file has more `describe` blocks competing for optimization budget. Worth monitoring.

**Stable:** State write, diamond (all shapes), and effect are holding steady. The core signal dispatch engine is solid.

**New scenarios:** State write with subscriber (5.1M), derived multi-dep (19.8M), diamond deep/wide, effect multi-dep (1.6M), pipe cached read (17.8M), and fan-out at 100 subscribers provide more granular visibility into real-world workloads.

**D3 impact:** Derived read and diamond benchmarks measure connected-mode (with subscribers) — D3's disconnect-on-unsub has no throughput cost here. The memory win is structural: disconnected derived stores hold zero upstream connections vs the pre-D3 perpetual connection.

---

## Level 3 + utils (algorithm baselines)

File: [`src/__bench__/data-algorithms.bench.ts`](../src/__bench__/data-algorithms.bench.ts).

| Scenario | Baseline | Intent | Baseline Hz | Recharge Hz | Gap | Δ vs prev |
|----------|----------|--------|-------------|-------------|-----|-----------|
| `reactiveMap` set/get | `Map` | Reactive KV overhead | 13.50 M | 8.37 M | 1.61x | stable (was 1.59x) |
| `reactiveMap.update` | Map RMW | Atomic update | 11.88 M | 7.47 M | 1.59x | stable (was 1.58x) |
| `select(k0).get` (churn) | `Map.get(k0)` | Per-key reactive view | 14.02 M | 8.38 M | 1.67x | stable (was 1.69x) |
| `reactiveLog.append` | `array.push` | Append path | 26.31 M | 12.07 M | 2.18x | stable (was 2.21x) |
| Bounded log | Ring buffer | Circular buffer trim | 32.82 M | 11.01 M | 2.98x | **improved** (was 3.19x) |
| `reactiveIndex` add/remove | Hand-rolled index | Index maintenance | 2.31 M | 1.81 M | 1.27x | stable (was 1.26x) |
| Index read | `Map.get` | Read hot path | 34.12 M | 28.70 M | 1.19x | **improved** (was 1.18x) |
| `lru()` | Naive MRU array | Eviction policy | 3.55 M | **6.40 M** | **0.58x** | stable |
| `scored` vs `reactiveScored` | evict(1)+reinsert | Heap + sub costs | 235 K | **880 K** | **0.27x** | **flipped** — was 17.3x slower, now 3.75x faster |
| `fifo()` | Array queue | FIFO policy | 7.24 M | 6.61 M | 1.09x | stable |
| 50× add + tag read | reactiveIndex | Collection overhead | 24.6 K | 960 | 25.6x | improved (was 42.4x) |

**Notable:** `lru()` beats its naive baseline (O(1) doubly-linked list vs O(n) array touch). Bounded log gap narrowed from 3.19x to 2.98x.

**`reactiveScored` flipped:** Replacing `effect()` with `subscribe()` (lightweight callbag sink — no DIRTY/RESOLVED protocol, no eager first run, no cleanup handling) yielded a **58.6x speedup** on evict+reinsert (15K → 880K ops/sec). `reactiveScored` now beats `scored()` even on the evict+reinsert micro-benchmark, while still providing O(log n) reactive heap maintenance.

**Collection gap:** Narrowed from 42.4x to 25.6x. Per-node overhead remains the primary cost: each `memoryNode` creates 3 reactive stores + 1 derived. The tag-tracking and eviction subscriptions now use lightweight `subscribe()`, but the store creation cost dominates at 50-node scale. Future optimizations: lazy node store creation (defer until first subscriber) or structural pooling.

---

## Micro-benchmarks

### pipe vs pipeRaw (3 operators)

In this run, `pipe` and `pipeRaw` show **~identical throughput** (~13M ops/sec in head-to-head, ~14.6M vs 14.1M when run solo). The `pipeRaw` benefit is reduced store count and memory (one store instead of N), not throughput.

### equals on diamond intermediates

`equals` with subtree skip showed ~7% overhead vs without in micro-benchmarks (1.44M vs 1.55M). The equality check cost is real but small; the win materializes when downstream subtrees are expensive and can be skipped via RESOLVED.

### batch: 10 sets + effect

Unbatched (387K) was ~12% faster than batched (345K) for 10 sequential sets. Batching adds bookkeeping overhead; its value is correctness (single effect re-run) not raw throughput for small batches. For larger graphs with many effects, batching wins.

### Inspector overhead

Store creation with Inspector ON: ~478K ops/sec. Inspector OFF: ~459K ops/sec. These numbers are noisy due to the short time window (~200ms) bench configuration — the high RME (±45-55%) means the difference is not statistically significant in this run.

---

## Bundle size

| Entry | ESM (Gzip) |
|---|---|
| `callbag-recharge` (full) | 8.05 KB |

Bundle has grown from 4.73 KB (core + extra only) to 8.05 KB as the library expanded to include utils, data, orchestrate, messaging, memory, patterns, worker, adapters, and compat modules. Core-only imports remain much smaller via subpath exports.

---

## Memory per store

Measure with Node `--expose-gc` if you need stable heap deltas; not part of the default Vitest bench suite.

| Library | bytes/store | heap delta (10K stores) |
|---|---|---|
| Preact Signals | **122 bytes** | 1,193 KB |
| callbag-recharge | 719 bytes | 7,021 KB |

The ~6x gap is structural (output slot model, bound methods, callbag protocol, Inspector WeakRefs). With D3's disconnect-on-unsub, *effective* memory improves since disconnected derived stores release dep references — the per-store allocation stays the same but idle stores no longer hold upstream connections.

---

<details>
<summary><strong>Previous results (early March 2026 — mixed core.bench + compare.bench)</strong></summary>

These numbers were collected from two separate bench files (`core.bench.ts` and `compare.bench.ts`) which have since been consolidated into a single file. Some numbers (state read, derived cached, fan-out) came from `core.bench.ts` which ran in isolation with fewer `describe` blocks, producing higher numbers due to V8 JIT having fewer competing optimization targets.

| Scenario | Ops/sec (Hz) | Notes |
|---|---|---|
| State read | 34.1 M | Hot path baseline |
| State write (no subs) | 18.8 M | Inlined `set()` fast path |
| Derived read (changed deps) | 23.0 M | P0 single-dep recomputation |
| Derived read (cached) | 34.0 M | Connected-mode cache hit |
| Diamond (A→B,C→D) | 16.4 M | Glitch-free, integer `_status` |
| Effect re-run | 6.9 M | Post-optimization baseline |
| Producer emit + get | 7.3 M | Stream-to-store bridge |
| Operator (transform) | 6.5 M | Improved node handling (+40%) |
| Pipe (3 operators) | 13.5 M | Composed derived chain |
| Fan-out (10 subscribers) | 1.8 M | Set iteration dispatch cost |

</details>

<details>
<summary><strong>Historical reference tables (fixed-iteration era)</strong></summary>

The tables below used **100,000 iterations / 1,000 warmup** via an earlier Node harness (since replaced by Vitest bench). Absolute numbers differ from tinybench due to measurement methodology. Treat these as **qualitative comparisons** showing relative standing vs external libraries.

| Scenario | callbag-recharge | Preact Signals | raw Callbag | Winner |
|---|---|---|---|---|
| State read | **175M** | 115M | — | Recharge |
| State write (no subs) | **47M** | 35M | — | Recharge |
| Derived read (changed deps) | **16M** | 15M | — | Recharge |
| Derived read (cached) | **208M** | 87M | — | Recharge |
| Diamond (A→B,C→D) | 7.2M | **10M** | — | Preact |
| Effect re-run | **26M** | 13.5M | — | Recharge |
| Producer emit + get | **29M** | 16.5M | — | Recharge |
| Operator (1 dep, transform) | **25M** | 12.4M | — | Recharge |
| Pipe (3 operators) | 23M | — | **103M** | raw Callbag |
| Fan-out (10 subs) | **4.7M** | 3.4M | — | Recharge |

</details>

---

## Perspective

At **~5M+ ops/sec** on hot paths, typical UIs (60fps = 16ms/frame) have enormous headroom. callbag-recharge trades some memory and diamond throughput for **inspectability, explicit deps, and correctness**. Level 3 structures add reactive indexing and logs on top of that baseline — use `pnpm run bench:data` to see overhead vs plain `Map`/arrays.
