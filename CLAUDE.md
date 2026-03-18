# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Build:** `npm run build` (tsup → ESM + CJS + .d.ts into `dist/`)
- **Test:** `npm test` (vitest run)
- **Test watch:** `npm run test:watch`
- **Single test:** `npx vitest run src/__tests__/core/basics.test.ts`
- **Lint:** `npm run lint` (biome check)
- **Lint fix:** `npm run lint:fix`
- **Format:** `npm run format`
- **Benchmarks:** `npm run bench` (Vitest + tinybench). Focused: `bench:core`, `bench:compare`, `bench:data`

## Architecture

callbag-recharge is a reactive state management library where **every store is a callbag source**. The callbag protocol (START=0, DATA=1, END=2) is the internal wiring; users interact through a simple `Store` interface (`get()`, `set()`, `source()`).

### Core primitives (src/core/)

- **`producer(fn?, opts?)`** — general-purpose source primitive. Lazy start (on first sink), auto-cleanup (on last sink disconnect). `autoDirty` (default true) sends DIRTY before each value. Options: `initial` (baseline value), `equals` (emit guard), `resetOnTeardown` (reset to initial on stop), `getter` (custom get()), `resubscribable` (allow re-subscription after error/complete — enables retry/rescue/repeat). Actions: `emit`, `signal`, `complete`, `error`.
- **`state(initial)`** — thin wrapper over `producer()`. `set()` inlines emit logic (fast path — skips bound method call). `equals` defaults to `Object.is`. `update(fn)` is sugar over `set`.
- **`derived(deps, fn)`** — computed store with explicit deps array. Uses dirty-dep counting for diamond resolution. Caches values; `equals` option enables push-phase memoization via RESOLVED signal. **Lazy STANDALONE** — no computation or connection at construction; first `get()` or `source()` triggers compute + connect. Single-dep nodes skip bitmask (P0 optimization). `derived.from(dep, opts?)` creates an identity-mode derived that skips `fn()` on recompute.
- **`operator(deps, init, opts?)`** — general-purpose transform primitive. Receives all signal types from upstream deps. Handler function `(depIndex, type, data) => void` decides what to forward downstream. Building block for tier 1 operators.
- **`effect(deps, fn)`** — side-effect runner with explicit deps array (`EffectImpl` class). Connects to deps once on creation (static deps). Tracks dirty deps via type 3 signals; runs `fn()` inline when all deps resolve. Returns a dispose function.
### Key design patterns (output slot + chain model)

See [docs/architecture.md](docs/architecture.md) for full architecture design.

- **Output slot model:** Replaces `_sinks: Set | null` with lazy output slot: `null → fn → Set`. Single subscriber avoids Set allocation (~200 bytes saved per node). P0 optimization.
- **Node status:** Every node tracks `_status: NodeStatus` (DISCONNECTED, DIRTY, SETTLED, RESOLVED, COMPLETED, ERRORED). Surfaced via `Inspector.inspect()`.
- **Lazy STANDALONE mode:** Derived nodes defer computation and connection until first `get()` or `source()`. After connection, `get()` returns cached value. Deps stay connected even without external subscribers. Unused derived stores incur zero overhead beyond object allocation.
- **Type 3 control channel:** State management signals (DIRTY, RESOLVED) flow on callbag type 3 (STATE). Type 1 DATA carries only real values — never sentinels. Unknown type 3 signals forwarded unchanged (forward-compatibility).
- **Two-phase push:** Phase 1: DIRTY propagates through the graph via type 3. Phase 2: values propagate via type 1. Derived nodes count dirty deps and wait for all to resolve before recomputing.
- **Tier model:** Tier 1 (state graph + passthrough operators) participates in diamond resolution via type 3. Tier 2 (async/timer/dynamic-subscription operators) are cycle boundaries — each `emit` starts a new DIRTY+value cycle.
- **Single-dep optimization (P0):** Single-dep derived/operator nodes skip bitmask — direct DIRTY/DATA forwarding. Multi-dep nodes use bitmask only at convergence points.
- **Producer as universal base:** All sources are built on `producer()`. State is a thin wrapper. Tier 2 extras use producer options (`initial`, `equals`, `resetOnTeardown`, `getter`, `error()`) to avoid manual implementations.
- **Batching:** `batch()` sends DIRTY immediately but defers type 1 value emission until the outermost batch ends. Connection batching (`deferStart`) queues producer starts until the full sink chain is wired.
- **Explicit deps, callbag wiring:** `derived` and `effect` take an explicit deps array. Callbag protocol is the sole connection mechanism — no implicit tracking.
- **Inspector:** Static class for opt-in observability via WeakMaps. Zero intrusion into primitives — no hooks in hot paths. Read-only metadata: `inspect()`, `graph()`, `getEdges()`, `dumpGraph()`, `snapshot()`. Callbag sinks: `observe()` (protocol-level test utility), `spy()` (observe + console logging), `trace()` (value change callback). Graph wrapper: `tap()` (transparent passthrough node for visualization). See `docs/test-guidance.md` for usage patterns.

### Extra modules (src/extra/)

**Tier 1** (participate in diamond resolution, forward type 3):
- Sources: `interval`, `fromIter`, `fromEvent`, `fromPromise`, `fromObs`, `of`, `empty`, `throwError`, `never`
- Operators: `take`, `skip`, `first`, `last`, `find`, `elementAt`, `partition`, `merge`, `combine`, `concat`, `flat`, `share`, `withLatestFrom` (primary+secondary deps pattern)
- Sinks: `forEach`, `subscribe`
- Piping: `pipeRaw`, `SKIP`

**Tier 2** (cycle boundaries, all built on `producer()`):
- Sources: `fromAsyncIter`
- Time-based: `debounce`, `throttle`, `delay`, `bufferTime`, `timeout`, `sample`, `audit`
- Buffering: `bufferCount`, `buffer`
- Dynamic subscription: `switchMap`, `flat`, `concatMap`, `exhaustMap`
- Aggregation: `reduce`, `toArray`, `groupBy`
- Multi-source: `race`
- Windowing: `window`, `windowCount`, `windowTime`
- Error handling: `rescue`, `retry`
- Resubscription: `repeat`

Each extra module is a separate entry point, tree-shakeable via `callbag-recharge/extra` or `callbag-recharge/extra/<name>`.

### Operators & pipe (src/core/pipe.ts)

`map`, `filter`, `scan` are `StoreOperator<A, B>` — functions that take a `Store<A>` and return a `Store<B>` (internally using `derived()`). Composed via `pipe()`. `pipeRaw()` (in `extra/pipeRaw.ts`) fuses all transform functions into a single `derived()` store for ~2x throughput. `SKIP` sentinel provides filter semantics in `pipeRaw`.

## Code style

- Biome: tabs, 100 char line width, `noExplicitAny: off`
- Completion signaling uses standard callbag END (type 2)
