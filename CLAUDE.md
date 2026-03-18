# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**pnpm workspace** (root = library, `site/` = docs). `corepack enable` then `pnpm install` (or `mise run bootstrap`). See `CONTRIBUTING.md` for commit conventions (semantic-release on `main`).

- **Build:** `pnpm run build` (tsup → ESM + CJS + .d.ts into `dist/`)
- **Test:** `pnpm test` (vitest run) — 44 test files, 1282 tests
- **Test watch:** `pnpm run test:watch`
- **Single test:** `pnpm exec vitest run src/__tests__/core/basics.test.ts`
- **Lint:** `pnpm run lint` (biome check)
- **Lint fix:** `pnpm run lint:fix`
- **Format:** `pnpm run format`
- **Benchmarks:** `pnpm run bench` (Vitest + tinybench). Focused: `bench:core`, `bench:compare`, `bench:data`
- **Bundle size:** `pnpm run size` → ~4.5 KB gzipped core

## Architecture

callbag-recharge is a reactive state management library where **every store is a callbag source**. The callbag protocol (START=0, DATA=1, END=2) is the internal wiring; users interact through a simple `Store` interface (`get()`, `set()`, `source()`).

### Core primitives (src/core/ — 11 files)

- **`producer(fn?, opts?)`** — general-purpose source primitive. Lazy start (on first sink), auto-cleanup (on last sink disconnect). `autoDirty` (default true) sends DIRTY before each value. Options: `initial` (baseline value), `equals` (emit guard), `resetOnTeardown` (reset to initial on stop), `getter` (custom get()), `resubscribable` (allow re-subscription after error/complete — enables retry/rescue/repeat). Actions: `emit`, `signal`, `complete`, `error`.
- **`state(initial)`** — thin wrapper over `producer()`. `set()` inlines emit logic (fast path — skips bound method call). `equals` defaults to `Object.is`. `update(fn)` is sugar over `set`.
- **`derived(deps, fn)`** — computed store with explicit deps array. Uses dirty-dep counting for diamond resolution. Caches values; `equals` option enables push-phase memoization via RESOLVED signal. **Fully lazy** — no computation or connection at construction. `get()` pull-computes from deps when disconnected (always fresh, no connection established). `source()` subscription triggers connection to deps; when all subscribers leave, derived disconnects from upstream. Single-dep nodes skip bitmask (P0 optimization). `derived.from(dep, opts?)` creates an identity-mode derived that skips `fn()` on recompute.
- **`operator(deps, init, opts?)`** — general-purpose transform primitive. Receives all signal types from upstream deps. Handler function `(depIndex, type, data) => void` decides what to forward downstream. Building block for tier 1 operators.
- **`effect(deps, fn)`** — side-effect runner with explicit deps array (`EffectImpl` class). Connects to deps once on creation (static deps). Tracks dirty deps via type 3 signals; runs `fn()` inline when all deps resolve. Returns a dispose function.

### Key design patterns (output slot + chain model)

See [docs/architecture.md](docs/architecture.md) for full architecture design.

- **Output slot model:** Replaces `_sinks: Set | null` with lazy output slot: `null → fn → Set`. Single subscriber avoids Set allocation (~200 bytes saved per node). P0 optimization.
- **Node status:** Every node tracks `_status: NodeStatus` (DISCONNECTED, DIRTY, SETTLED, RESOLVED, COMPLETED, ERRORED). Packed as 3-bit integer in `_flags` bits 7-9. Surfaced via `Inspector.inspect()`.
- **Lazy derived with disconnect-on-unsub:** Derived nodes defer computation and connection until first use. `get()` pull-computes from deps without establishing a connection (always fresh). `source()` subscription connects to deps; when all subscribers leave, derived disconnects from upstream and returns to the disconnected state. Next `get()` pull-computes again; next `source()` reconnects. Unused derived stores incur zero overhead beyond object allocation.
- **Type 3 control channel:** State management signals (DIRTY, RESOLVED) flow on callbag type 3 (STATE). Type 1 DATA carries only real values — never sentinels. Unknown type 3 signals forwarded unchanged (forward-compatibility).
- **Two-phase push:** Phase 1: DIRTY propagates through the graph via type 3. Phase 2: values propagate via type 1. Derived nodes count dirty deps and wait for all to resolve before recomputing.
- **Tier model:** Tier 1 (state graph + passthrough operators) participates in diamond resolution via type 3. Tier 2 (async/timer/dynamic-subscription operators) are cycle boundaries — each `emit` starts a new DIRTY+value cycle.
- **Single-dep optimization (P0):** Single-dep derived/operator nodes skip bitmask — direct DIRTY/DATA forwarding. Multi-dep nodes use bitmask only at convergence points.
- **Producer as universal base:** All sources are built on `producer()`. State is a thin wrapper. Tier 2 extras use producer options (`initial`, `equals`, `resetOnTeardown`, `getter`, `error()`) to avoid manual implementations. D3 higher-order operators (`switchMap`, `concatMap`, `exhaustMap`, `flat`) accept an optional `{ initial: B }` option that narrows the return type from `B | undefined` to `B`.
- **Batching:** `batch()` sends DIRTY immediately but defers type 1 value emission until the outermost batch ends. Connection batching (`deferStart`) queues producer starts until the full sink chain is wired.
- **Explicit deps, callbag wiring:** `derived` and `effect` take an explicit deps array. Callbag protocol is the sole connection mechanism — no implicit tracking.
- **Inspector:** Static class for opt-in observability via WeakMaps. Zero intrusion into primitives — no hooks in hot paths. Read-only metadata: `inspect()`, `graph()`, `getEdges()`, `dumpGraph()`, `snapshot()`. Callbag sinks: `observe()` (protocol-level test utility), `spy()` (observe + console logging), `trace()` (value change callback). Graph wrapper: `tap()` (transparent passthrough node for visualization). See `docs/test-guidance.md` for usage patterns.

### Extra modules (src/extra/ — 58 operators, 60 files)

**Tier 1** (participate in diamond resolution, forward type 3):
- Sources: `interval`, `fromIter`, `fromEvent`, `fromPromise`, `fromObs`, `of`, `empty`, `throwError`, `never`
- Operators: `take`, `skip`, `first`, `last`, `find`, `elementAt`, `partition`, `merge`, `combine`, `concat`, `flat`, `share`, `withLatestFrom`, `takeUntil`, `distinctUntilChanged`, `startWith`, `pairwise`
- Sinks: `forEach`, `subscribe`
- Piping: `pipeRaw`, `SKIP`

**Tier 2** (cycle boundaries, all built on `producer()`):
- Sources: `fromAsyncIter`
- Time-based: `debounce`, `throttle`, `delay`, `bufferTime`, `timeout`, `sample`, `audit`
- Buffering: `bufferCount`, `buffer`
- Dynamic subscription: `switchMap`, `flat`, `concatMap`, `exhaustMap` — purely reactive (D3): inner subscriptions created only when outer emits (no eager `fn(outer.get())`). Accept optional `{ initial: B }` to narrow return type from `B | undefined` to `B`. `concatMap` also accepts `{ maxBuffer }` for queue backpressure (default: no limit).
- Aggregation: `reduce`, `toArray`, `groupBy`
- Multi-source: `race`
- Windowing: `window`, `windowCount`, `windowTime`
- Error handling: `rescue`, `retry`
- Resubscription: `repeat`

**Utilities:** `tap`, `remember`, `subject`, `wrap` (RxJS/callbag interop)

Each extra module is a separate entry point, tree-shakeable via `callbag-recharge/extra` or `callbag-recharge/extra/<name>`.

### Data structures (src/data/ — Level 3)

Reactive data structures built on core primitives. Version-gated pattern: `state<number>` version counter bumped on structural changes, with lazy derived stores.

- **`reactiveMap`** — reactive key-value store. Select, keysStore, sizeStore, events, TTL, pluggable eviction, namespaces.
- **`reactiveLog`** — append-only reactive log. Bounded mode uses circular buffer. Reactive lengthStore, latest, tail(n).
- **`reactiveIndex`** — dual-key reactive index. O(1) reverse map. 1.01x native Map.get on reads.
- **`pubsub`** — topic-based publish/subscribe. Each topic is a lazy state store.

All implement `NodeV0` interface (`id`, `version`, `snapshot()`).

### Memory (src/memory/ — Level 3)

Agent memory primitives built on data structures:
- **`memoryNode`** — content + metadata + reactive score
- **`collection`** — bounded container with decay-scored eviction via `reactiveIndex` tag integration
- **`decay` / `computeScore`** — recency decay, importance, frequency scoring

### Orchestrate (src/orchestrate/ — Level 3E)

Lightweight scheduling composing with existing primitives:
- **`fromCron`** — producer that emits on cron schedule (built-in zero-dependency parser)
- **`taskState`** — reactive task execution tracker (status, duration, error, runCount)
- **`dag`** — acyclicity validation + Inspector graph registration (Kahn's algorithm)

### Utils (src/utils/)

Pure strategies with zero reactive deps (except `reactiveEviction`):
- **`backoff`** — constant, linear, exponential, fibonacci, decorrelatedJitter
- **`eviction`** — fifo, lru, lfu, scored, random
- **`reactiveEviction`** — O(log n) min-heap with reactive score stores

### Patterns (src/patterns/)

- **`createStore`** — Zustand-compatible API with diamond-safe selectors

### Operators & pipe (src/core/pipe.ts)

`map`, `filter`, `scan` are `StoreOperator<A, B>` — functions that take a `Store<A>` and return a `Store<B>` (internally using `derived()`). Composed via `pipe()`. `pipeRaw()` (in `extra/pipeRaw.ts`) fuses all transform functions into a single `derived()` store for ~2x throughput. `SKIP` sentinel provides filter semantics in `pipeRaw`.

### Folder & dependency hierarchy

```
src/
├── core/          ← 5 primitives + protocol + inspector + pipe + types
├── extra/         ← 58 operators, sources, sinks (tree-shakeable)
├── utils/         ← pure strategies (backoff, eviction)
├── data/          ← reactive data structures (map, log, index, pubsub)
├── memory/        ← agent memory (node, collection, decay)
├── orchestrate/   ← scheduling (fromCron, taskState, dag)
├── patterns/      ← composed recipes (createStore)
├── adapters/      ← external connectors (planned)
├── compat/        ← drop-in API wrappers (planned)
└── index.ts       ← public API barrel
```

**Strict import rules:**
- `core/` never imports from `extra/`, `utils/`, `data/`, or `memory/`
- `extra/` imports from `core/` and `utils/` only, never from each other
- `utils/` never imports from `extra/`, `data/`, or `memory/` (except `reactiveEviction.ts` → `core/effect`)
- `data/` imports from `core/` and `utils/` only
- `memory/` imports from `core/`, `utils/`, and `data/`
- `orchestrate/` imports from `core/` and `data/` only

## Code style

- Biome: tabs, 100 char line width, `noExplicitAny: off`
- Completion signaling uses standard callbag END (type 2)
- Integer `_status` packed into `_flags` (bits 7-9) for V8 optimization; string exposed via getter
