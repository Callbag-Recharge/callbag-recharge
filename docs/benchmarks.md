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

## Level 3 + utils (algorithm baselines)

File: [`src/__bench__/data-algorithms.bench.ts`](../src/__bench__/data-algorithms.bench.ts).

| Scenario | Baseline | Intent |
|----------|----------|--------|
| `reactiveMap` set/get | `Map` | Reactive KV overhead, no subscribers |
| `reactiveMap.update` | Map RMW | Atomic update vs manual get/set |
| `select(k0).get` with other-key churn | `Map.get(k0)` | Per-key reactive view vs raw read |
| `reactiveLog.append` | `array.push` | Append path |
| Bounded log | Ring buffer (same cap) | Trim vs minimal circular buffer |
| `reactiveIndex` add/remove cycle | Hand-rolled forward + reverse map | Index maintenance cost |
| Index read | `Map.get` vs `select().get` | Read hot path |
| `lru()` | Naive MRU array | Eviction policy vs O(n) touch |
| `scored` vs `reactiveScored` | evict(1)+reinsert on fixed N | Scan-at-evict vs heap + effect-driven scores |
| `fifo()` | Array queue + lazy delete | FIFO policy vs simple queue |
| 50× add + tag read | `reactiveIndex` only vs `collection` | Full memory node + effects vs index-only |

**Interpreting `reactiveScored`:** `evict(1)` + `insert` reattaches subscriptions; that path is heavier than `scored()`’s pure scan for this micro-scenario. The heap pays off when scores change often and evictions are rare (e.g. large collections).

---

## Historical reference tables (fixed-iteration era)

The tables below used **100,000 iterations / 1,000 warmup** via an earlier Node harness (since replaced by Vitest bench). Vitest bench may report different relative ordering for some cases (e.g. effect scheduling). Treat these as **qualitative**; run `pnpm run bench` for current tinybench output.

### State read

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **175M** | 0.6ms |
| Preact Signals | 115M | 0.9ms |

### State write (no subscribers)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **47M** | 2.1ms |
| Preact Signals | 35M | 2.9ms |

### Computed/derived read after dependency change

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **16M** | 6.3ms |
| Preact Signals | 15M | 6.6ms |

### Computed/derived read (unchanged dependencies)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **208M** | 0.5ms |
| Preact Signals | 87M | 1.2ms |

### Diamond (A->B, A->C, B+C->D) write + read

| Library | ops/sec | time (100K ops) |
|---|---|---|
| Preact Signals | **10M** | 10.0ms |
| callbag-recharge | 7.2M | 14.0ms |

### Effect re-run

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **26M** | 3.8ms |
| Preact Signals | 13.5M | 7.4ms |

### Producer emit + get (with subscriber)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **29M** | 3.5ms |
| Preact Signals | 16.5M | 6.1ms |

### Operator (1 dep, transform)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **25M** | 4.0ms |
| Preact Signals | 12.4M | 8.1ms |

### Pipe (3 operators) push through

| Library | ops/sec | time (100K ops) |
|---|---|---|
| raw Callbag | **103M** | 1.0ms |
| callbag-recharge `pipe` | 23M | 4.3ms |

### Fan-out (10 subscribers)

| Library | ops/sec | time (100K ops) |
|---|---|---|
| **callbag-recharge** | **4.7M** | 21.3ms |
| Preact Signals | 3.4M | 29.4ms |

### Memory per store (10,000 stores)

Measure with Node `--expose-gc` if you need stable heap deltas; not part of the default Vitest bench suite.

| Library | bytes/store | heap delta |
|---|---|---|
| Preact Signals | **122 bytes** | 1,193 KB |
| callbag-recharge | 719 bytes | 7,021 KB |

---

## Optimization benchmarks (historical)

### Inspector disabled vs enabled (store creation)

| Variant | ops/sec | time (10K ops) |
|---|---|---|
| Inspector OFF | **6.6M** | 1.5ms |
| Inspector ON (default) | 1.1M | 9.1ms |

Vitest: see `compare: Inspector ON/OFF` in `pnpm run bench`.

### batch() — 10 set() calls with effect

| Variant | ops/sec | time (10K ops) |
|---|---|---|
| Batched | **1.4M** | 7.3ms |
| Unbatched | 1.3M | 8.1ms |

### pipeRaw vs pipe (3 operators)

Roughly similar throughput; `pipeRaw` saves intermediate nodes.

### equals on diamond intermediates

Small pull-phase cost; wins when downstream can skip on RESOLVED.

---

## Bundle size

| Entry | ESM | CJS |
|---|---|---|
| `callbag-recharge` (core) | 1.12 KB | 4.02 KB |

---

## Perspective

At **~5M+ ops/sec** on hot paths, typical UIs (60fps ≈ 16ms/frame) have enormous headroom. callbag-recharge trades some memory and diamond throughput for **inspectability, explicit deps, and correctness**. Level 3 structures add reactive indexing and logs on top of that baseline—use `pnpm run bench:data` to see overhead vs plain `Map`/arrays.
