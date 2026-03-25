# SESSION: Callbag-Native Promise Elimination

**Date:** 2026-03-24
**Topic:** Audit all Promise/await usage across codebase; design plan to make every API callbag-in/callbag-out; eliminate internal `firstValueFrom` usage; break pre-1.0 APIs as needed.

---

## Context

176 results across 53 files using Promise patterns (`await`, `new Promise`, `Promise.all`, `Promise.race`, `for await`, `.then()`). Architecture §1.16 says "no raw `new Promise`" but the deeper issue is: many internal APIs return Promises or consume Promises directly, breaking the continuity of reactive callbag flows.

**Philosophy shift:** The library should be **callbag-in, callbag-out everywhere**. Promise bridges are only for end-users who need to exit callbag-land (like `node:fs/promises` is to `node:fs`). Internally, all system boundary calls (fetch, fs, IDB, reader.read) should be wrapped into callbag sources immediately. User-provided callbacks should be wrapped with `rawFromAny` for maximum flexibility (sync, Promise, AsyncIterable, callbag all accepted).

---

## New Raw Primitives

| Primitive | Purpose | Based on |
|-----------|---------|----------|
| `raw/fromPromise` | Promise → callbag source. Emits resolved value, END. Rejects → END with error. | `extra/fromPromise` minus `producer` dep |
| `raw/fromAsyncIter` | AsyncIterable → callbag source. Emits each yielded value, END on done. | `extra/fromAsyncIter` minus `producer`/`Inspector` deps |
| `raw/fromAny` | Universal → callbag. Dispatches: PromiseLike → rawFromPromise, AsyncIterable → rawFromAsyncIter, Iterable → sync emit, plain value → emit once. | `extra/fromAny` minus `producer` dep |
| `raw/race` | First source to emit wins, unsubscribes from losers. [RxJS reference](https://github.com/ReactiveX/rxjs/blob/7.8.2/src/internal/observable/race.ts). | New |

All use raw callbag protocol (START=0, DATA=1, END=2) with zero core deps.

---

## Replacement Pattern Cheatsheet

| Promise Pattern | Callbag Replacement |
|----------------|---------------------|
| `new Promise((r) => setTimeout(r, ms))` | `fromTimer(ms)` |
| `await somePromise` | `rawSubscribe(rawFromPromise(somePromise), cb)` |
| `Promise.race([a, b])` | `race(sourceA, sourceB)` |
| `Promise.all([a, b])` | Subscribe both, collect into array, emit when all done (or `raw/forkJoin` if pattern recurs) |
| `Promise.resolve(x).then(f)` | `rawFromAny(x)` → pipe/map |
| `for await (const x of iter)` | `rawFromAsyncIter(iter)` → `rawSubscribe` |
| `await fn(args)` (user callback) | `rawFromAny(fn(args))` → `rawSubscribe` (handles sync, Promise, AsyncIterable, callbag) |
| `setInterval(fn, ms)` | `interval(ms)` (exists in extra) |
| `setTimeout(fn, ms)` | `rawSubscribe(fromTimer(ms), fn)` |

---

## APIs to Break (Pre-1.0, No Backward Compat)

### 1. `rateLimiter.acquire()` → callbag source

**Current:** `acquire(tokens?, signal?): Promise<number>`
**New:** Returns callbag source — emits `number` (ms waited) then END.

Consumers: `chatStream/index.ts:135`, `cancellableAction.ts:121`. Eliminate internal `sleep()` helper entirely.

### 2. `asyncQueue.enqueue()` → callbag source

**Current:** `enqueue(task: T): Promise<R>`
**New:** Returns callbag source — emits result `R` then END.

Consumer: `executionLogAdapters.node.ts:63` (adapter interface also changes).

### 3. `CheckpointAdapter` methods → callbag sources

**Current:** `save/load/clear` return `Promise | void/undefined`
**New:** Return callbag source or `void`. Consumer code in `checkpoint.ts` already does `instanceof Promise` branching — change to detect callbag source (or use `rawFromAny` to normalize).

Implementations: `indexedDBAdapter()` returns `fromIDBRequest` directly (no `firstValueFrom` wrapper). `fileAdapter()` returns `rawFromPromise(fs.writeFile(...))`. Sync adapters unchanged.

### 4. `ExecutionLogPersistAdapter` methods → callbag sources

Same pattern as CheckpointAdapter. `indexedDBLogAdapter()` returns callbag from `fromIDBRequest` directly. `fileLogAdapter()` returns callbag via `rawFromPromise`.

### 5. `connectionHealth` callbacks → callbag via `rawFromAny`

**Current:** `heartbeat: (signal) => Promise<void>`, `connect: (signal) => Promise<void>`
**New:** User callbacks can return anything. Wrap with `rawFromAny` internally.

`doHeartbeat()` / `doConnect()` restructure: `rawSubscribe(rawFromAny(callbacks.heartbeat(signal)), onSuccess, { onError })`.

### 6. `webhook.listen()` / `sse.listen()` → callbag source

**Current:** Returns `Promise<void>` via `firstValueFrom(fromNodeCallback(...))`
**New:** Returns `fromNodeCallback(...)` callbag source directly.

---

## Orchestrate Internals — Eliminate `firstValueFrom` + `await`

| File | Line | Current | Replacement |
|------|------|---------|-------------|
| `task.ts` | 275 | `await firstValueFrom(fromTimer(delay))` | `rawSubscribe(fromTimer(delay), () => runTask(attempt + 1))` — continuation-based retry |
| `task.ts` | 244-249 | `Promise.race([maybePromise, firstValueFrom(fromTimer(timeout)).then(throw)])` | `race(rawFromAny(maybePromise), fromTimer(timeout))` — callbag-native race |
| `sensor.ts` | 168 | `Promise.resolve(poll(...)).then().catch()` | `rawSubscribe(rawFromAny(poll(signal, value)), onResult, { onError })` |
| `sensor.ts` | 196-200 | `Promise.race([waitForPoll, rawFirstValueFrom(fromTimer(timeout))])` | `race(done$.source, fromTimer(timeout))` |
| `loop.ts` | 211 | `await firstValueFrom(child.status, s => terminal(s))` | `subscribe(child.status, s => { if (terminal(s)) handleResult(s) })` |
| `subPipeline.ts` | 199 | Same as loop.ts | Same reactive subscribe approach |
| `workflowNode.ts` | 103 | `await firstValueFrom(fromTimer(duration))` | `rawSubscribe(fromTimer(duration), onComplete)` |
| `jobQueue.ts` | 206 | `await rawFirstValueFrom(fromTimer(delay, signal))` | `rawSubscribe(fromTimer(delay, signal), () => continueRetry())` |
| `jobQueue.ts` | 212 | `await firstValueFrom(_pausedStore, v => !v)` | `subscribe(_pausedStore, v => { if (!v) continueProcessing() })` |

---

## System Boundary Calls → `rawFromPromise` / `rawFromAsyncIter`

| File | Current | Replacement |
|------|---------|-------------|
| `adapters/http.ts` | `await fetch(...)` | `rawFromPromise(fetch(...))` → subscribe |
| `adapters/mcp.ts` | `await client.listTools()` | `rawFromPromise(client.listTools())` |
| `ai/fromLLM.ts` | `await fetchFn(...)` + `while (await reader.read())` | `rawFromPromise(fetchFn(...))` + `rawFromAsyncIter(response.body)` |
| `ai/docIndex/index.ts` | `await fetchFn(dbUrl)` | `rawFromPromise(fetchFn(dbUrl))` |
| `ai/embeddingIndex/index.ts` | `Promise.all([fetch, fetch, import])` | Subscribe three `rawFromPromise` sources, collect |
| `ai/chatStream/index.ts` | `for await (chunk of iterable)` | `rawFromAsyncIter(iterable)` → subscribe |
| `utils/cancellableStream.ts` | `for await (chunk of factory(signal))` | `rawFromAsyncIter(() => factory(signal))` → subscribe |

---

## User-Provided Async Callbacks → `rawFromAny`

Using `rawFromAny` means user callbacks can return sync values, Promises, AsyncIterables, or callbag sources — maximum flexibility.

| File | Current | Replacement |
|------|---------|-------------|
| `orchestrate/task.ts:252` | `const r = await maybePromise` | `rawFromAny(maybePromise)` → subscribe |
| `orchestrate/forEach.ts:254` | `return await fn(signal, item, index)` | `rawFromAny(fn(signal, item, index))` |
| `orchestrate/onFailure.ts:126` | `const result = await handler(signal, error)` | `rawFromAny(handler(...))` |
| `ai/agentLoop/index.ts:285,292,314` | `ctx = await opts.observe(ctx)` | `rawFromAny(opts.observe(ctx))` |
| `ai/toolCallState/index.ts:151` | `const result = await fn(args)` | `rawFromAny(fn(args))` |
| `patterns/textEditor/index.ts:169` | `await opts?.onSubmit?.(content)` | `rawFromAny(opts.onSubmit(content))` |

---

## Examples

| File | Current | Replacement |
|------|---------|-------------|
| `form-builder.ts:25` | `new Promise<void>((r, reject) => { setTimeout(r, 200); ... })` | `rawSubscribe(fromTimer(200, signal), () => { ... })` |

---

## Where `firstValueFrom` Survives

After all refactors:
1. **`raw/firstValueFrom.ts`** — the implementation itself (the ONE `new Promise`)
2. **Tests** — test harness code may use it for convenience
3. **Exported for end users** — `extra/firstValueFrom` stays as a convenience for users who need to bridge OUT of callbag-recharge into Promise-land (like `node:fs/promises` is to `node:fs`)

**Not used internally in any production `src/` code.**

---

## Implementation Order

1. **Create raw primitives** — `fromPromise`, `fromAsyncIter`, `fromAny`, `race`
2. **Break low-level APIs** — rateLimiter, asyncQueue, checkpoint/execLog adapters, webhook/sse listen
3. **Refactor orchestrate internals** — task, sensor, loop, subPipeline, forEach, workflowNode, jobQueue
4. **Refactor higher layers** — adapters, ai modules, utils (connectionHealth, cancellableAction, cancellableStream)
5. **Update examples**
6. **Write replacement patterns blog** (for both internal reference and user docs)

---

## Key Decisions

1. **Pre-1.0 means break freely.** No backward compat, no deprecation wrappers, no legacy re-exports.
2. **`rawFromAny` for user callbacks.** Not just `rawFromPromise` — users get maximum flexibility (sync, Promise, AsyncIterable, callbag all accepted).
3. **`rawFromAsyncIter(response.body)` over manual reader loop.** More direct, stays in callbag-land.
4. **`raw/race` operator.** Needed for timeout racing (replaces `Promise.race`). Extra version for Store-level use.
5. **Promise version as future separate export.** Like `node:fs/promises` — a convenience wrapper, not the primary API. Consider post-1.0 for adoption.
6. **`firstValueFrom` stays exported but unused internally.** It's the user's escape hatch from callbag to Promise, not an internal tool.
7. **Document replacement patterns** in CLAUDE.md and as a blog post. Serves as both AI instruction and user education.

---

## Rejected Alternatives

- **Keep Promise APIs for "convenience"** — breaks reactive continuity, loses composition.
- **Only fix `new Promise` literal violations** — misses the deeper issue (internal `await` everywhere).
- **Add `forkJoin` immediately** — wait to see if `Promise.all` replacements recur enough to justify.
- **Wrap `firstValueFrom` differently** — the issue isn't the bridge, it's using it internally at all.

---

**Outcome:** Architecture §1.20 added (callbag-native output). CLAUDE.md updated with replacement patterns. Roadmap updated with in-progress item. Implementation deferred to next session.
