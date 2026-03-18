# Benchmarks

Comparative benchmarks against [@preact/signals-core](https://github.com/preactjs/signals), raw [callbag](https://github.com/callbag/callbag), and **in-process algorithm baselines** for Level 3 data structures (`reactiveMap`, `reactiveLog`, `reactiveIndex`, eviction utils, `collection`).

## Running benchmarks (Vitest + tinybench)

All benchmarks run via **[Vitest bench](https://vitest.dev/guide/features.html#benchmarking)**, which uses **[tinybench](https://github.com/tinylibs/tinybench)** for timing, warmup, and statistical summaries (mean latency, throughput, relative “x faster than” within each `describe` group).

```bash
pnpm install
pnpm run bench              # full suite (core + compare + data algorithms)
pnpm run bench:core         # primitives only (ex- bench.ts)
pnpm run bench:compare      # Recharge vs Preact vs callbag (ex- bench-compare.ts)
pnpm run bench:data         # Level 3 vs plain JS baselines only
```

- **Tests** stay separate: `*.bench.ts` under `src/__bench__/` are excluded from `pnpm test` ([vitest.config.ts](../vitest.config.ts)).
- **Redis** is intentionally not part of these benchmarks (fair algorithm comparisons are in-process only).
- Absolute numbers vary by CPU and Node version; use relative comparisons within each group and re-run before/after architectural changes.
- **Inspector store-creation** benches use a short time window (~200ms) so each run does not allocate unbounded `state()` instances during tinybench sampling.

---

## Current results (March 2026 — Tinybench)

Measured on Node v22+ using `vitest bench`. Hz = ops/sec. Post-D3 architecture (lazy Tier 2, derived disconnect-on-unsub).

| Scenario | Ops/sec (Hz) | Notes |
|---|---|---|
| **State read** | **35.0 M** | Hot path baseline |
| **State write (no subs)** | **18.8 M** | Inlined `set()` fast path |
| **Derived read (changed deps)** | **23.4 M** | P0 single-dep recomputation |
| **Derived read (cached)** | **33.9 M** | Connected-mode cache hit |
| **Diamond (A→B,C→D)** | **16.8 M** | Glitch-free, integer `_status` |
| **Effect re-run** | **4.4 M** | Multi-dep scheduling overhead |
| **Producer emit + get** | **7.9 M** | Stream-to-store bridge |
| **Operator (transform)** | **4.4 M** | Single-dep operator node |
| **Pipe (3 operators)** | **13.8 M** | Composed derived chain |
| **Fan-out (10 subscribers)** | **1.8 M** | Set iteration dispatch cost |

**D3 impact:** Derived read and diamond benchmarks measure connected-mode (with subscribers) — D3’s disconnect-on-unsub has no throughput cost here. The memory win is structural: disconnected derived stores hold zero upstream connections vs the pre-D3 perpetual connection.

---

## Level 3 + utils (algorithm baselines)

File: [`src/__bench__/data-algorithms.bench.ts`](../src/__bench__/data-algorithms.bench.ts).

| Scenario | Baseline | Intent | Baseline Hz | Recharge Hz | Gap |
|----------|----------|--------|-------------|-------------|-----|
| `reactiveMap` set/get | `Map` | Reactive KV overhead | 14.17 M | 8.55 M | 1.66x |
| `reactiveMap.update` | Map RMW | Atomic update | 8.45 M | 7.59 M | 1.11x |
| `select(k0).get` (churn) | `Map.get(k0)` | Per-key reactive view | 14.32 M | 8.14 M | 1.76x |
| `reactiveLog.append` | `array.push` | Append path | 26.78 M | 11.99 M | 2.23x |
| Bounded log | Ring buffer | Circular buffer trim | 32.58 M | 10.67 M | 3.05x |
| `reactiveIndex` add/remove | Hand-rolled index | Index maintenance | 2.13 M | 1.73 M | 1.23x |
| Index read | `Map.get` | Read hot path | 33.61 M | 28.39 M | 1.18x |
| `lru()` | Naive MRU array | Eviction policy | 3.66 M | **6.07 M** | **0.60x** |
| `scored` vs `reactiveScored` | evict(1)+reinsert | Heap + sub costs | 261 K | 14 K | 18.6x |
| `fifo()` | Array queue | FIFO policy | 7.33 M | 5.93 M | 1.24x |
| 50× add + tag read | Index-only | Collection overhead | 1.0 K | **42.9 K** | **0.02x** |

**Notable:** `lru()` beats its naive baseline (O(1) doubly-linked list vs O(n) array touch). Collection’s version-gated lazy materialization is 42.9x faster than the old index-only baseline.

**Interpreting `reactiveScored`:** `evict(1)` + `insert` reattaches subscriptions; that path is heavier than `scored()`’s pure scan for this micro-scenario. The heap pays off when scores change often and evictions are rare (e.g. large collections).

---

## Micro-benchmarks

### pipeRaw vs pipe (3 operators)

`pipeRaw` (fused) is generally **5-10% faster** than `pipe` in micro-benchmarks. Main benefit is reduced store count and memory, not throughput.

### equals on diamond intermediates

Pull-phase cost is negligible; wins when downstream can skip resolution on `RESOLVED` signals.

---

## Bundle size

| Entry | ESM (Gzip) | CJS (Gzip) |
|---|---|---|
| `callbag-recharge` (full core + extra) | 4.73 KB | 5.05 KB |

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
