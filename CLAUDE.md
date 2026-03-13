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
- **`derived(fn)`** — computed store. Always re-runs `fn()` on `get()` (no cache by default). Auto-tracks dependencies via `tracking.ts` context. Connects to upstream callbag sources lazily on first read. When `equals` option is provided, caches last output and returns cached value if equal.
- **`stream(producer)`** — store backed by an async event source. Producer receives `(emit, request, complete)`. Supports pull-based streams via `request()` handler. Uses deferred start (`protocol.ts`) so producers don't emit before sinks are wired.
- **`effect(fn)`** — side-effect runner. Tracks deps like `derived`, re-runs when any dep's DIRTY propagates. Returns a dispose function.
- **`subscribe(store, cb)`** — listen to value changes with previous-value tracking.

### Key design patterns

- **Push DIRTY, pull values:** `state.set()` propagates `DIRTY` symbol through the callbag graph. Subscribers/effects then call `get()` to pull the actual value. This avoids redundant computation in diamond dependency graphs.
- **Batching:** `protocol.ts` manages two batching layers: (1) DIRTY propagation batching — effects run only after all DIRTY signals propagate, (2) connection batching — `beginDeferredStart`/`endDeferredStart` queue producer starts until the full sink chain is wired. `batch()` leverages the same depth counter to coalesce multiple `set()` calls.
- **Tracking context:** `tracking.ts` uses a global `currentTracker` set. When `derived`/`effect` runs its function, any `store.get()` call registers that store as a dependency (same pattern as Signals/MobX).
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
