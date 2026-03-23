# Test Guidance

Guidelines for writing, organizing, and maintaining tests in callbag-recharge. Read this before adding any new tests.

---

## Guiding Principles

1. **Verify before fixing.** Every "known bug" is a hypothesis until a test exposes it. Write the test first. If it passes, the hypothesis was wrong — delete the test or adjust expectations. Do not blindly implement fixes.

2. **Existing tests may be wrong.** When a new test contradicts an existing test's expectation, read the source code to determine which is correct. The source is the authority — update whichever test has the wrong expectation. Prior test authors (including AI agents) may have encoded wrong assumptions about RxJS semantics or library-specific design choices.

3. **Design choices ≠ bugs.** Some behaviors are intentional divergences from RxJS:
   - `share()` is a no-op because stores are inherently multicast.
   - `state` completes (unlike TC39 Signal.State which is infinite).
   - Completion ordering is cleanup-first (diverges from callbag-basics convention).

   When in doubt, write the test, see what happens, and check the architecture doc before "fixing."

4. **Test what the code *should* do, not what it *does*.** Write tests expressing the correct semantic. If the test fails, that's a real bug. If it passes, the code was already correct.

5. **One concern per test.** Each `it()` should verify one specific behavior. Do not bundle "happy path + error + completion + reconnect" into one test.

6. **Inspector-first for assertions.** Use `Inspector.observe()` for collecting emitted values and signals in tests — never wire raw callbag sinks (`store.source(0, ...)`) or ad-hoc `observeRaw()` helpers. Raw sinks are only acceptable when testing the callbag protocol itself (e.g., `callbag.test.ts`).

7. **Authority hierarchy for expected behavior:**
   - `docs/architecture.md` → primary. Defines correct behavior for this library.
   - RxJS documentation → for operator semantics when not explicitly covered above.
   - TC39 Signals spec → for `state` equality and reactivity semantics.
   - Callbag spec → for protocol-level behavior.

---

## Test File Organization

```
src/__tests__/
├── core/           ← core primitives, protocol, inspector
│   ├── basics.test.ts                  — fundamental producer/state/derived/effect/subscribe
│   ├── callbag.test.ts                 — callbag protocol compliance, type 1 purity
│   ├── completion-ordering.test.ts     — END propagation semantics, upstream disconnect
│   ├── inspector.test.ts               — Inspector registration, graph, trace, enabled/disabled
│   ├── optimizations.test.ts           — pipeRaw + SKIP, hidden class checks
│   ├── primitives-edge-cases.test.ts   — producer/state/derived/effect/operator edge cases
│   ├── protocol-edge-cases.test.ts     — batch(), deferStart, interop
│   ├── signals.test.ts                 — DIRTY/RESOLVED control flow, diamond resolution
│   └── two-phase.test.ts              — two-phase push, diamond topologies
├── extra/          ← operators, sources, lifecycle, stress
│   ├── batch7-gaps.test.ts             — flat/switchMap/repeat/pipeRaw/SKIP/Inspector gaps
│   ├── dedup-correctness.test.ts       — equals guards, no auto-dedup in extras
│   ├── edge-cases.test.ts              — operator edge cases (general)
│   ├── extras-cycle-boundary.test.ts   — tier 2 as cycle boundary
│   ├── extras-roadmap.test.ts          — feature coverage tracking
│   ├── extras-tier1.test.ts            — passthrough operators
│   ├── extras-tier2.test.ts            — time-based, dynamic subscription
│   ├── extras-tier2-operators.test.ts  — switchMap, concatMap, exhaustMap, rescue, retry
│   ├── reconnect.test.ts               — disconnect→reconnect for all operators
│   ├── regressions.test.ts             — bug regression suite (never delete)
│   ├── selection-operators.test.ts     — first/last/find/elementAt/partition
│   ├── sources.test.ts                 — fromIter/fromPromise/fromObs/fromEvent/interval/buffer
│   └── stress.test.ts                  — reentrancy, rapid churn, complex chains, memory
├── utils/          ← pure utility tests
│   ├── backoff.test.ts               — backoff strategies (constant, linear, exponential, fibonacci, decorrelatedJitter, withMaxAttempts)
│   ├── eviction.test.ts              — eviction policies (fifo, lru, lfu, scored, random)
│   └── reactiveEviction.test.ts      — reactive scored eviction (min-heap + effect subscriptions)
├── data/           ← Level 3 reactive data structure tests
│   ├── reactiveMap.test.ts           — CRUD, reactive API, TTL, namespace, eviction, lifecycle
│   ├── reactiveLog.test.ts           — append, bounded trim, reactive stores, events, lifecycle
│   ├── reactiveIndex.test.ts         — add/remove/update, reactive select/keys/size, lifecycle
│   ├── pubsub.test.ts                — publish/subscribe, multi-topic, reactive effects, destroy
│   └── nodeV0.test.ts                — id/version/snapshot for all data structures
├── orchestrate/   ← Level 3E scheduling primitive tests
│   ├── cron.test.ts                  — cron parser validation, field parsing, matching
│   ├── dag.test.ts                   — acyclicity validation, topological sort, cycle detection
│   ├── fromCron.test.ts              — cron source emission, timing, cleanup, fake timers
│   ├── pipeline.test.ts              — pipeline status, reset, task lifecycle, source(), skip
│   └── taskState.test.ts             — run tracking, status transitions, snapshot, lifecycle
└── integrations/
    └── interop.test.ts                 — external callbag operator compatibility
```

**Rule:** New tests go in the most specific existing file. Create a new file only when the scope is genuinely orthogonal to all existing files.

---

## What to Test for Every Operator

### For tier 1 operators (operator-based)

- [ ] **Happy path:** correct output for basic input
- [ ] **Type 3 forwarding:** DIRTY propagates to downstream
- [ ] **RESOLVED when suppressing:** filter/distinctUntilChanged/equals sends RESOLVED (not silence)
- [ ] **Upstream error → `error(data)` forwarded**, not swallowed or converted to complete
- [ ] **Upstream completion → `complete()` forwarded**
- [ ] **Reconnect:** local state resets on disconnect→reconnect (handler-local vars reset because init re-runs)
- [ ] **Diamond resolution:** in a diamond topology (A→B→D, A→C→D), D computes exactly once

### For tier 2 operators (producer-based)

- [ ] **Happy path:** correct output for basic input
- [ ] **Upstream error → forwarded**
- [ ] **Upstream completion → forwarded** (some operators flush pending on complete, e.g., debounce)
- [ ] **Teardown:** all resources cleaned up (timers cleared, inner unsub called)
- [ ] **Reconnect:** fresh state after reconnect (timer restarts, queue empty, etc.)
- [ ] **get() value:** correct before first emit, correct after several emits
- [ ] **Sync inner completion race** (for flat/switchMap/concatMap/exhaustMap): inner completes synchronously after outer completes → operator completes

### For source operators (producer-based sources)

- [ ] **Emits expected values**
- [ ] **Completes correctly**
- [ ] **Error forwarded** (fromPromise rejection, fromObs error, etc.)
- [ ] **Cleanup on unsubscribe** (listener removed, iterator released, etc.)
- [ ] **Multiple subscribers:** multicast behavior (shared underlying source, not multiple listeners)
- [ ] **Late subscriber after completion:** gets immediate START + END

### For sink functions (subscribe, forEach)

- [ ] **Callback called with correct values**
- [ ] **Unsubscribe function disconnects cleanly**
- [ ] **Does not track DIRTY** (sinks are purely reactive to DATA)

---

## Diamond Resolution Testing Pattern

Diamond tests are critical — they verify that derived nodes compute exactly once even when multiple paths connect them to the same source.

```ts
// Standard diamond topology
const a = state(1);
const b = derived([a], () => a.get() * 2);   // a → b
const c = derived([a], () => a.get() + 10);  // a → c
const d = derived([b, c], () => b.get() + c.get());  // b,c → d

let dCount = 0;
effect([d], () => { dCount++; });

a.set(5);
expect(dCount).toBe(1);   // d computes once, not twice
expect(d.get()).toBe(25); // (5*2) + (5+10) = 10 + 15 = 25
```

Always verify:
1. The count (exactly once per upstream change)
2. The value (correct final value with all deps resolved)

---

## RESOLVED Signal Testing Pattern

RESOLVED enables subtree skipping. Test that downstream nodes skip computation when a dep sends RESOLVED.

```ts
const a = state(1);
const b = derived([a], () => a.get(), { equals: Object.is }); // same value → RESOLVED
const c = derived([b], () => b.get() + 100);

let cCount = 0;
effect([c], () => { cCount++; });

// Setting a to same value → b sends RESOLVED → c skips
a.set(1); // same value
expect(cCount).toBe(0); // c did not run
```

---

## Inspector Debugging Tools

Inspector provides static methods for test assertions and debugging. **This is the mandatory tool for observing store output in tests** — do not use raw callbag sinks or ad-hoc helpers. See `src/core/inspector.ts` for the full API.

### Anti-patterns (do NOT use in tests)

```ts
// ❌ Raw callbag sink — hard to read, easy to get wrong
const values: number[] = [];
store.source(0, (t: number, d: any) => {
  if (t === 1) values.push(d);
});

// ❌ Ad-hoc helper that reimplements observe()
function observeRaw(store) { /* ... */ }

// ✅ Inspector.observe() — typed, complete, standard
const obs = Inspector.observe(store);
expect(obs.values).toEqual([1, 2, 3]);
```

### `Inspector.observe(store)` — primary test utility

Returns a live observation object. Replaces ad-hoc `observeRaw()` and raw `store.source(START, ...)` patterns.

```ts
const obs = Inspector.observe(s);
obs.values          // DATA payloads only
obs.signals         // STATE payloads
obs.events          // full protocol order: [{ type, data }, ...]
obs.eventLog        // compact: ["DIRTY", 5, "DIRTY", 10, "END"]
obs.dirtyCount      // DIRTY signal count
obs.resolvedCount   // RESOLVED signal count
obs.ended           // true after END
obs.endError        // error payload if END(error)
obs.completedCleanly // ended && no error
obs.errored         // ended && has error
obs.dispose()       // unsubscribe
obs.reconnect()     // dispose + fresh observe on same store
```

### `Inspector.activate(store)` — subscribe without observing

When you only need to trigger the subscription lifecycle (no assertions on values/signals):

```ts
Inspector.activate(s);                  // fire-and-forget
const dispose = Inspector.activate(s);  // with cleanup
dispose();
```

### When to use which tool

| Use case | Best tool |
|---|---|
| **"Did it recompute once?"** | Inline counter in `fn()` |
| **"What values were emitted?"** | `obs.values` |
| **"Was DIRTY sent before DATA?"** | `obs.eventLog` → `["DIRTY", 5, ...]` |
| **"Did RESOLVED skip downstream?"** | `obs.resolvedCount` |
| **"Did it complete cleanly?"** | `obs.completedCleanly` |
| **"Did it error?"** | `obs.errored` + `obs.endError` |
| **"Disconnect and re-subscribe"** | `obs.reconnect()` |
| **"Just activate, no assertions"** | `Inspector.activate(store)` |
| **"What's the full graph state?"** | `Inspector.snapshot()` or `Inspector.dumpGraph()` |
| **"Graph as Mermaid/D2 for docs"** | `Inspector.toMermaid()` or `Inspector.toD2()` |
| **"Trace one store's value changes"** | `Inspector.trace(store, cb)` |
| **"Insert a debug point in the graph"** | `Inspector.tap(store, name)` |
| **"Log events live to console"** | `Inspector.spy(store)` |
| **"Was this event inside batch()?"** | `obs.events[i].inBatch` |
| **"Timestamped event log per store"** | `Inspector.timeline(store)` |
| **"What deps triggered a derived?"** | `Inspector.observeDerived(store).evaluations` |
| **"Emission count / ended / error?"** | `withMeta(store)` (from `utils`) |

---

## Error Forwarding Testing Pattern

Always verify that errors propagate as errors (not completions):

```ts
const source = producer<number>(({ error }) => {
  setTimeout(() => error(new Error("fail")), 0);
});

const obs = Inspector.observe(source);
// after async...
expect(obs.ended).toBe(true);
expect(obs.endError).toBeInstanceOf(Error);
```

---

## Reconnect Testing Pattern

Reconnect tests verify that operators produce correct behavior after all subscribers disconnect and a new subscriber connects.

```ts
const a = state(0);
const skipped = pipe(a, skip(2));

// First subscription
const values1: number[] = [];
const unsub1 = subscribe(skipped, v => values1.push(v));
a.set(1); a.set(2); a.set(3);
unsub1();
// values1 = [3] (skipped first 2)

// Reconnect — skip counter must reset
const values2: number[] = [];
const unsub2 = subscribe(skipped, v => values2.push(v));
a.set(4); a.set(5); a.set(6);
unsub2();
// values2 = [6] (skip resets, first 2 of new session skipped)
expect(values2).toEqual([6]);
```

---

## v4: Output Slot Testing Patterns

The output slot model introduces topology invariants. Key things to verify:

### Output slot mode transitions (DISCONNECTED → SINGLE → MULTI → DISCONNECTED)

1. **A never gets extra subscribers** during SINGLE → MULTI (output slot absorbs topology changes)
2. **B._value stays current** while connected (push-based)
3. **Values are not duplicated** during transition (no replay artifacts)
4. **get() pull-computes correctly** when all subscribers leave (DISCONNECTED)

### Diamond topology with output slots

Bitmask must resolve correctly even though B's output slot (not B directly) dispatches to C. Verify single-compute with both SINGLE and MULTI modes on intermediate nodes.

### Other invariants

- **Status lifecycle**: SETTLED after data, DIRTY during two-phase push, COMPLETED on terminal
- **Type 3 forwarding**: Unknown `[Symbol, data?]` tuples pass through unchanged
- **init() timing**: Handler-local state resets on reconnect; dep connection structure survives
- Prefer `Inspector.observe()` over raw callbag sinks for assertions

---

## Orchestrate / Pipeline Testing Patterns

Pipeline tests verify workflow-level behavior: status derivation, task lifecycle, reset, and the `source()` / `task()` API. Use `task()` and `source()` — never raw `step()` + `switchMap` + `producer` combos.

### Pipeline status derivation

Pipeline status depends on **task-level** `taskState.status` stores, not stream-level meta. Test all status transitions:

```ts
const trigger = fromTrigger<string>();
const wf = pipeline({
  trigger: source(trigger),
  fetch: task(["trigger"], async (_signal, [v]) => fetchData(v)),
});

expect(wf.status.get()).toBe("idle");

trigger.fire("go");
expect(wf.status.get()).toBe("active");

await vi.waitFor(() => expect(wf.status.get()).toBe("completed"));
```

### Skipped tasks count as "done"

When a task's `skip` predicate returns true, its status becomes `"skipped"`. Pipeline treats skipped + success as all-done → `"completed"`:

```ts
const wf = pipeline({
  trigger: source(fromTrigger<string>()),
  a: task(["trigger"], async () => "result", { skip: () => true }),
  b: task(["trigger"], async () => "result"),
});

trigger.fire("go");
await vi.waitFor(() => expect(wf.status.get()).toBe("completed"));
```

### Reset returns to idle

After reset, all task statuses revert to `"idle"` and the pipeline status returns to `"idle"`:

```ts
trigger.fire("go");
await vi.waitFor(() => expect(wf.status.get()).toBe("completed"));

wf.reset();
expect(wf.status.get()).toBe("idle");
```

### Task lifecycle hooks

Verify `onSkip`, `onStart`, `onSuccess`, `onError` fire at the correct points:

```ts
const events: string[] = [];
const wf = pipeline({
  trigger: source(fromTrigger<string>()),
  work: task(["trigger"], async () => "done", {
    onStart: () => events.push("start"),
    onSuccess: (r) => events.push(`success:${r}`),
  }),
});

trigger.fire("go");
await vi.waitFor(() => expect(events).toEqual(["start", "success:done"]));
```

### source() vs step()

`source()` is the public API for wrapping event sources into pipeline nodes. `step()` is `@internal`. Test that `source()` tags correctly:

```ts
import { SOURCE_ROLE, source, step } from "../../orchestrate/pipeline";

const def = source(someStore);
expect((def as any)[SOURCE_ROLE]).toBe(true);

const rawDef = step(someStore);
expect((rawDef as any)[SOURCE_ROLE]).toBeUndefined();
```

### What to test for pipeline

- [ ] **Status transitions:** idle → active → completed, idle → active → errored
- [ ] **Skipped tasks:** skip predicate → status "skipped", pipeline still completes
- [ ] **Mixed outcomes:** some skipped + some success → completed; some skipped + some error → errored
- [ ] **Reset:** completed → reset → idle; re-trigger works after reset
- [ ] **Task lifecycle hooks:** onStart, onSuccess, onError, onSkip fire correctly
- [ ] **source() tagging:** SOURCE_ROLE symbol present on source(), absent on step()
- [ ] **Destroy cleanup:** wf.destroy() tears down all subscriptions

---

## Regression Tests

The `regressions.test.ts` file records every confirmed bug that was found and fixed. **Never delete entries from this file.** Each regression test should have a comment explaining:

```ts
// Bug: flat inner sync completion race — innerUnsub overwritten by subscribe() return
// Fixed: added innerEnded flag guard after subscribe() call
// Date: 2026-01-xx
```

When a bug is fixed, add the regression test immediately before closing the issue.

---

### Watch list

- `derived` and `effect` send END back to the dep that just sent them END (in the upstream-disconnect loop). For standard producers/derived this is safe (talkback guards against double-END). A custom callbag source that doesn't guard could misbehave. Add a regression test if this is ever observed.
