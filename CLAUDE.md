# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Build:** `npm run build` (tsup → ESM + CJS + .d.ts into `dist/`)
- **Test:** `npm test` (vitest run)
- **Test watch:** `npm run test:watch`
- **Single test:** `npx vitest run src/__tests__/basics.test.ts`
- **Lint:** `npm run lint` (biome check)
- **Lint fix:** `npm run lint:fix`
- **Format:** `npm run format`

## Architecture

callbag-recharge is a reactive state management library where **every store is a callbag source**. The callbag protocol (START=0, DATA=1, END=2) is the internal wiring; users interact through a simple `Store` interface (`get()`, `set()`, `source()`).

### Core primitives (src/)

- **`state(initial)`** — writable store. `set()` pushes `DIRTY` sentinel through callbag sinks (not the value itself). Actual values are pulled lazily via `get()`. Supports custom `equals` option to replace `Object.is`.
- **`derived(deps, fn)`** — computed store with explicit deps array. Always re-runs `fn()` on `get()` (no cache by default). Connects to upstream callbag sources lazily in `source()` (on first sink), disconnects when last sink leaves. `get()` is pure pull with no side effects. When `equals` option is provided, caches last output and returns cached reference if equal — but this is pull-phase only; DIRTY still propagates unconditionally to downstream sinks.
- **`stream(producer)`** — store backed by an async event source. Producer receives `(emit, request, complete)`. Supports pull-based streams via `request()` handler. Uses deferred start (`protocol.ts`) so producers don't emit before sinks are wired.
- **`effect(deps, fn)`** — side-effect runner with explicit deps array. Connects to deps once on creation (static deps). Re-runs `fn()` when any dep's DIRTY propagates. Returns a dispose function.
- **`subscribe(store, cb)`** — listen to value changes with previous-value tracking.

### Key design patterns

- **Push DIRTY, pull values:** `state.set()` propagates `DIRTY` symbol through the callbag graph. Subscribers/effects then call `get()` to pull the actual value. This avoids redundant computation in diamond dependency graphs.
- **Batching:** `protocol.ts` manages two batching layers: (1) DIRTY propagation batching — effects run only after all DIRTY signals propagate, (2) connection batching — `beginDeferredStart`/`endDeferredStart` queue producer starts until the full sink chain is wired. `batch()` leverages the same depth counter to coalesce multiple `set()` calls.
- **Explicit deps, callbag wiring:** `derived` and `effect` take an explicit deps array. Callbag protocol is the sole connection mechanism — no implicit tracking. The `fn` still calls `.get()` to pull values.
- **Inspector:** Opt-in observability via WeakMaps. Stores stay lean; debug metadata (names, kinds) lives in `Inspector` singleton. `Inspector.enabled` flag (default: true in dev) makes `register()`/`getName()` no-ops when false.

### Extra modules (src/extra/)

Sources: `interval`, `fromIter`, `fromEvent`, `fromPromise`, `fromObs`
Operators: `take`, `skip`, `merge`, `combine`, `concat`, `flat`, `share`
Sinks: `forEach`

Each extra module is a separate entry point, tree-shakeable via `callbag-recharge/extra` or `callbag-recharge/extra/<name>`.

### Operators & pipe (src/pipe.ts)

`map`, `filter`, `scan` are `StoreOperator<A, B>` — functions that take a `Store<A>` and return a `Store<B>` (internally using `derived()`). Composed via `pipe()`. `pipeRaw()` fuses all transform functions into a single `derived()` store for ~2x throughput. `SKIP` sentinel provides filter semantics in `pipeRaw`.

## Code style

- Biome: tabs, 100 char line width, `noExplicitAny: off`
- Completion signaling uses standard callbag END (type 2) — do not add completion methods to `StreamProducer`
