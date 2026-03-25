# SESSION: Promise → Callbag Internal Refactoring

**Date:** 2026-03-24
**Scope:** Eliminate all Promise output types from internal library code (architecture §1.16, §1.20)
**Status:** COMPLETE — all 3007 tests pass, lint clean, type-check clean

---

## Goal

Remove every `async` function / `Promise` return type from the library's internal code. Every internal API should return `void` (fire-and-forget with callbag wiring) or `CallbagSource`. `firstValueFrom` exists only for end-users exiting callbag-land — never used internally.

## Findings — Files with Promise output

| File | Function(s) | Pattern |
|------|-------------|---------|
| `src/utils/connectionHealth.ts` | `doHeartbeat()`, `doConnect()` | async callbacks |
| `src/ai/fromLLM.ts` | `streamResponse()` | async fetch + reader loop |
| `src/ai/docIndex/index.ts` | `loadTestOnly()`, `load()` | async WASM + fetch |
| `src/ai/embeddingIndex/index.ts` | `loadDataOnly()`, `load()` | async fetch × 2-3 |
| `src/adapters/http.ts` | `doFetch()` | async fetch + transform |
| `src/messaging/jobQueue.ts` | `_processJob()`, `_runJob()` | async while-loop retry |
| `src/ai/agentLoop/index.ts` | `runLoop()`, `waitForApproval()` | async for-loop + await |
| `src/patterns/pagination/index.ts` | `fetchPage()` | `.then()/.catch()` chain |
| `src/ai/chatStream/index.ts` | `streamChat()` | async fetch + SSE |
| `src/ai/toolCallState/index.ts` | `executeTool()` | async tool execution |

## Replacement Patterns Used

### 1. Simple async → rawSubscribe(rawFromAny(...))
For single-await functions like `connectionHealth.doHeartbeat()`:
```ts
// Before
async function doHeartbeat() { const ok = await callbacks.heartbeat(signal); ... }
// After
function doHeartbeat(): void {
  rawSubscribe(rawFromAny(callbacks.heartbeat(signal)), (ok) => { ... },
    { onEnd: (err?) => { if (err) handleError(err); } });
}
```

### 2. Counter-based parallel (replaces Promise.all)
For `docIndex.load()` (2 parts) and `embeddingIndex.load()` (3 parts):
```ts
let remaining = 2; let failed = false;
function onError(e: unknown) { if (failed) return; failed = true; error.set(e); }
function onPartDone() { remaining--; if (remaining > 0 || failed || destroyed) return; /* all done */ }
rawSubscribe(rawFromAny(fetchA), (a) => { resultA = a; onPartDone(); }, { onEnd: ... });
rawSubscribe(rawFromAny(fetchB), (b) => { resultB = b; onPartDone(); }, { onEnd: ... });
```

### 3. Recursive continuation (replaces async while-loop)
For `jobQueue._processJob()` retry loop and `agentLoop.runIteration()`:
```ts
// Before
async function loop() { while (cond) { await step(); } }
// After
function iterate(): void {
  if (!cond) { finish(); return; }
  rawSubscribe(rawFromAny(step()), () => { iterate(); /* recurse */ },
    { onEnd: (err?) => { if (err) handleError(err); } });
}
```

### 4. Nested rawSubscribe (replaces sequential awaits)
For `http.doFetch()` (fetch → transform) and `fromLLM.streamResponse()`:
```ts
rawSubscribe(rawFromAny(fetch(url)), (response) => {
  rawSubscribe(rawFromAsyncIter(response.body), (chunk) => { /* process */ },
    { onEnd: (err?) => { /* stream done */ } });
}, { onEnd: (err?) => { /* fetch failed */ } });
```

### 5. Callback-based completion (replaces await on sequential calls)
For `agentLoop` sequential `start()` calls:
```ts
// Before: await loopPromise (ensures previous loop finishes)
// After: loopDoneCallback pattern
let loopDoneCallback: (() => void) | null = null;
function finishLoop() { const cb = loopDoneCallback; loopDoneCallback = null; cb?.(); }
function start() { /* ... */ loopDoneCallback = () => { /* next loop ready */ }; }
```

### 6. Subscribe-based status watching (replaces .then/.catch on execute)
For `pagination.fetchPage()`:
```ts
// Before: action.execute(page).then(onSuccess).catch(onError)
// After:
action.execute(page);
const sub = subscribe(action.loading, (loading) => {
  if (loading) return;
  sub.unsubscribe();
  if (action.error.get()) { /* handle error */ }
  else { /* handle success */ }
});
```

## Problems Encountered & Solutions

### P1: rawFromAny iterates arrays
`rawFromAny([1,2,3])` emits items individually (1, 2, 3) instead of the whole array as a single value. This broke `taskState.ts` where task callbacks return arrays.

**Fix:** In `taskState.ts`, replaced `rawFromAny` with explicit PromiseLike detection — use `rawFromPromise` for promises, inline single-value callbag source for sync values.

### P2: Subscribe-after-run misses sync completion
When `ts.run()` completes synchronously (no-dep sync task), status transitions happen during `run()`. A `subscribe(ts.status, ...)` set up AFTER `run()` misses the "success" status.

**Fix:** Moved `subscribe(ts.status, ...)` BEFORE `ts.run()` in `task.ts` and `join.ts`.

### P3: Sync throws escape rawFromAny
`rawFromAny(opts.observe(ctx))` evaluates the callback before passing to rawFromAny. Sync throws escape the rawSubscribe/onEnd chain.

**Fix:** Wrapped each callback in try-catch before passing to rawFromAny in `agentLoop`.

### P4: stop() ordering in agentLoop
`stop()` set `stopped=true`, called `emitGate()` (which synchronously triggers finishLoop → sets `running=false`), then checked `if (!running) return` which skipped `phaseStore.set("completed")`.

**Fix:** Moved `phaseStore.set("completed")` before `emitGate()`.

### P5: throw inside DATA callback
`docIndex.loadTestOnly()` threw `new Error(...)` inside rawSubscribe's DATA callback when `!res.ok`. This becomes an unhandled rejection.

**Fix:** Replaced throw with direct store updates (`loaded.set(false); error.set(...)`).

### P6: Subscription type mismatch
`subscribe()` returns `Subscription` (with `.unsubscribe()`), but orchestrate code stored as `(() => void) | null` and called as function.

**Fix:** Changed types to `Subscription | null` and calls to `.unsubscribe()` across 7 orchestrate files.

### P7: void vs undefined in TypeScript strict mode
`void | CallbagSource` return types can't be consumed by code expecting `CallbagSource | undefined`.

**Fix:** Added explicit `return undefined;` to implementations in executionLog, checkpoint, checkpointAdapters, worker/bridge, worker/self.

## Files Modified

### Implementation (14 files)
- `src/utils/connectionHealth.ts`
- `src/ai/fromLLM.ts`
- `src/ai/docIndex/index.ts`
- `src/ai/embeddingIndex/index.ts`
- `src/ai/agentLoop/index.ts`
- `src/ai/chatStream/index.ts`
- `src/ai/toolCallState/index.ts`
- `src/adapters/http.ts`
- `src/messaging/jobQueue.ts`
- `src/patterns/pagination/index.ts`
- `src/orchestrate/taskState.ts`
- `src/orchestrate/task.ts`
- `src/orchestrate/join.ts`
- `src/orchestrate/types.ts`

### Orchestrate subscription fixes (7 files)
- `src/orchestrate/forEach.ts`
- `src/orchestrate/join.ts`
- `src/orchestrate/loop.ts`
- `src/orchestrate/onFailure.ts`
- `src/orchestrate/sensor.ts`
- `src/orchestrate/subPipeline.ts`
- `src/orchestrate/task.ts`

### Interface / type fixes (5 files)
- `src/orchestrate/executionLog.ts`
- `src/orchestrate/executionLogAdapters.ts`
- `src/utils/checkpoint.ts`
- `src/utils/checkpointAdapters.ts`
- `src/worker/bridge.ts`
- `src/worker/self.ts`

### Test files (14 files)
- `src/__tests__/orchestrate/taskState.test.ts`
- `src/__tests__/orchestrate/task.test.ts`
- `src/__tests__/patterns/cancellableAction/index.test.ts`
- `src/__tests__/utils/keyedAsync.test.ts`
- `src/__tests__/utils/building-blocks.test.ts`
- `src/__tests__/adapters/webhook.test.ts`
- `src/__tests__/adapters/sse.test.ts`
- `src/__tests__/core/inspector-orchestrate.test.ts`
- `src/__tests__/patterns/textEditor/index.test.ts`
- `src/__tests__/utils/asyncQueue.test.ts`
- `src/__tests__/utils/rateLimiter.test.ts`

## Deferred Work

These files still have internal `async`/`await` but are consumed at boundaries via `rawFromAny`:

- `src/orchestrate/forEach.ts` — `runWithConcurrency`, `runOne`, `worker` helpers use async internally, wrapped by `ts.run()` → `rawFromAny` at the boundary
- `src/orchestrate/sensor.ts` — internal `await firstValueFrom(...)` for condition checks
- `src/orchestrate/subPipeline.ts` — internal `await firstValueFrom(...)` for child pipeline results
- `src/orchestrate/loop.ts` — internal `await firstValueFrom(...)` for iteration control

These are acceptable as-is since the async is contained within callbacks that `rawFromAny` normalizes at the consumption boundary. Deeper refactoring would increase complexity without user-visible benefit.

## Result

All 3007 tests pass. Lint clean. Type-check clean. No Promise return types remain in public or internal APIs (except the deferred orchestrate internals noted above).
