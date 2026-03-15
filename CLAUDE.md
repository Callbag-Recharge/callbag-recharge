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

## Architecture

callbag-recharge is a reactive state management library where **every store is a callbag source**. The callbag protocol (START=0, DATA=1, END=2) is the internal wiring; users interact through a simple `Store` interface (`get()`, `set()`, `source()`).

### Core primitives (src/core/)

- **`producer(fn?, opts?)`** — general-purpose source primitive. Lazy start (on first sink), auto-cleanup (on last sink disconnect). `autoDirty` (default true) sends DIRTY before each value. Options: `initial` (baseline value), `equals` (emit guard), `resetOnTeardown` (reset to initial on stop), `getter` (custom get()), `resubscribable` (allow re-subscription after error/complete — enables retry/rescue/repeat). Actions: `emit`, `signal`, `complete`, `error`.
- **`state(initial)`** — thin wrapper over `producer()`. `set()` = `emit()` with `equals` defaulting to `Object.is`. `update(fn)` is sugar over `set`.
- **`derived(deps, fn)`** — computed store with explicit deps array. Uses dirty-dep counting for diamond resolution. Caches values; `equals` option enables push-phase memoization via RESOLVED signal. Connects lazily, disconnects when last sink leaves.
- **`operator(deps, init, opts?)`** — general-purpose transform primitive. Receives all signal types from upstream deps. Handler function `(depIndex, type, data) => void` decides what to forward downstream. Building block for tier 1 operators.
- **`effect(deps, fn)`** — side-effect runner with explicit deps array (`EffectImpl` class). Connects to deps once on creation (static deps). Tracks dirty deps via type 3 signals; runs `fn()` inline when all deps resolve. Returns a dispose function.
### Key design patterns (v3 — type 3 control channel)

See [docs/architecture.md](docs/architecture.md) for full design.

- **Type 3 control channel:** State management signals (DIRTY, RESOLVED) flow on callbag type 3 (STATE). Type 1 DATA carries only real values — never sentinels. This makes operators callbag-compatible without DIRTY awareness.
- **Two-phase push:** Phase 1: DIRTY propagates through the graph via type 3. Phase 2: values propagate via type 1. Derived nodes count dirty deps and wait for all to resolve before recomputing.
- **Tier model:** Tier 1 (state graph + passthrough operators) participates in diamond resolution via type 3. Tier 2 (async/timer/dynamic-subscription operators) are cycle boundaries — each `emit` starts a new DIRTY+value cycle.
- **Producer as universal base:** All sources are built on `producer()`. State is a thin wrapper. Tier 2 extras use producer options (`initial`, `equals`, `resetOnTeardown`, `getter`, `error()`) to avoid manual implementations.
- **Batching:** `batch()` sends DIRTY immediately but defers type 1 value emission until the outermost batch ends. Connection batching (`deferStart`) queues producer starts until the full sink chain is wired.
- **Explicit deps, callbag wiring:** `derived` and `effect` take an explicit deps array. Callbag protocol is the sole connection mechanism — no implicit tracking.
- **Inspector:** Opt-in observability via WeakMaps. Stores stay lean; debug metadata (names, kinds) lives in `Inspector` singleton. `Inspector.enabled` flag (default: true in dev) makes `register()`/`getName()` no-ops when false.

### Extra modules (src/extra/)

**Tier 1** (participate in diamond resolution, forward type 3):
- Sources: `interval`, `fromIter`, `fromEvent`, `fromPromise`, `fromObs`, `of`, `empty`, `throwError`, `never`
- Operators: `take`, `skip`, `first`, `last`, `find`, `elementAt`, `partition`, `merge`, `combine`, `concat`, `flat`, `share`
- Sinks: `forEach`, `subscribe`
- Piping: `pipeRaw`, `SKIP`

**Tier 2** (cycle boundaries, all built on `producer()`):
- Time-based: `debounce`, `throttle`, `delay`, `bufferTime`, `timeout`, `sample`
- Dynamic subscription: `switchMap`, `flat`, `concatMap`, `exhaustMap`
- Error handling: `rescue`, `retry`
- Resubscription: `repeat`

Each extra module is a separate entry point, tree-shakeable via `callbag-recharge/extra` or `callbag-recharge/extra/<name>`.

### Operators & pipe (src/core/pipe.ts)

`map`, `filter`, `scan` are `StoreOperator<A, B>` — functions that take a `Store<A>` and return a `Store<B>` (internally using `derived()`). Composed via `pipe()`. `pipeRaw()` (in `extra/pipeRaw.ts`) fuses all transform functions into a single `derived()` store for ~2x throughput. `SKIP` sentinel provides filter semantics in `pipeRaw`.

## Code style

- Biome: tabs, 100 char line width, `noExplicitAny: off`
- Completion signaling uses standard callbag END (type 2)
