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

6. **Authority hierarchy for expected behavior:**
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

Inspector provides static methods that work as callbag sinks — zero intrusion into production primitives. Use these in tests and debugging sessions instead of writing ad-hoc raw callbag observation code.

### `Inspector.observe(store)` — protocol-level observation

The primary test utility. Replaces ad-hoc `observeRaw()` helpers and raw `store.source(START, ...)` patterns. Returns a live observation object that grows as the store emits.

```ts
const s = state(0);
const obs = Inspector.observe(s);

s.set(1);
s.set(2);

obs.values       // [1, 2] — DATA payloads only
obs.signals      // [DIRTY, DIRTY] — STATE payloads
obs.events       // full protocol order: [{ type: "signal", data: DIRTY }, { type: "data", data: 1 }, ...]
obs.dirtyCount   // 2
obs.resolvedCount // 0
obs.ended        // false
obs.endError     // undefined
obs.name         // store name from Inspector registration
obs.dispose()    // unsubscribe
```

**Use for:** checking emitted values, verifying END/error propagation, counting DIRTY/RESOLVED signals, verifying protocol event ordering.

### `Inspector.tap(store, name?)` — graph visualization wrapper

Creates a transparent passthrough node visible in the graph. Delegates `get()` and `source()` to the original store. Zero overhead.

```ts
const a = state(1, { name: "a" });
const tapped = Inspector.tap(a, "debug_a");
// tapped.get() delegates to a.get()
// subscribers through tapped connect directly to a
// Inspector.snapshot() shows "debug_a" as a distinct node with edge from "a"
```

**Use for:** inserting named observation points in the graph during debugging without modifying production code.

### `Inspector.spy(store, opts?)` — observe + console logging

Same as `observe()` but also logs every event to console. For interactive debugging sessions.

```ts
const obs = Inspector.spy(myStore, { name: "debug" });
// Console output: [debug] STATE: DIRTY, [debug] DATA: 42, etc.
obs.values  // same as observe()
obs.dispose()
```

### `Inspector.snapshot()` — JSON-serializable graph

Returns `{ nodes, edges }` — the full graph as JSON. Designed for AI consumption.

```ts
const snap = Inspector.snapshot();
// snap.nodes: [{ name, kind, value, status }, ...]
// snap.edges: [{ from, to }, ...]
JSON.stringify(snap) // works
```

### `Inspector.dumpGraph()` — pretty-print for console/CLI

```ts
console.log(Inspector.dumpGraph());
// Store Graph (3 nodes):
//   count (state) = 42  [SETTLED]
//   doubled (derived) = 84  [SETTLED]
//   label (derived) = "value=84"  [SETTLED]
```

### When to use which tool

| Use case | Best tool |
|---|---|
| **"Did it recompute once?"** | Inline counter in `fn()` |
| **"What values were emitted?"** | `Inspector.observe(store).values` |
| **"Was DIRTY sent before DATA?"** | `Inspector.observe(store).events` |
| **"Did RESOLVED skip downstream?"** | `Inspector.observe(store).resolvedCount` |
| **"Did it complete/error?"** | `Inspector.observe(store).ended` / `.endError` |
| **"What's the full graph state?"** | `Inspector.snapshot()` or `Inspector.dumpGraph()` |
| **"Trace one store's value changes"** | `Inspector.trace(store, cb)` |
| **"Insert a debug point in the graph"** | `Inspector.tap(store, name)` |
| **"Log events live to console"** | `Inspector.spy(store)` |

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

The output slot model introduces new topology invariants that must be verified.

### Output slot mode transitions

Test that mode transitions (STANDALONE → SINGLE → MULTI → SINGLE → STANDALONE) preserve value correctness and don't leak subscriptions.

```ts
// STANDALONE → SINGLE: derived keeps its value through adoption
const a = state(1)
const b = derived([a], () => a.get() * 2)
expect(b.get()).toBe(2) // STANDALONE — b drives itself

const values: number[] = []
const unsub = subscribe(b, v => values.push(v)) // → SINGLE
a.set(5)
expect(b.get()).toBe(10) // b still current
expect(values).toEqual([10])

// SINGLE → MULTI: second subscriber joins without upstream reconnection
const values2: number[] = []
const unsub2 = subscribe(b, v => values2.push(v))
a.set(7)
expect(values).toEqual([10, 14])
expect(values2).toEqual([14]) // D joined mid-stream

// MULTI → SINGLE → STANDALONE
unsub2()
a.set(8)
expect(values).toEqual([10, 14, 16]) // C still works
unsub()
expect(b.get()).toBe(16) // back to STANDALONE, value retained
a.set(9)
expect(b.get()).toBe(18) // STANDALONE still reactive
```

Always verify:
1. **A never gets extra subscribers** during SINGLE → MULTI (the output slot absorbs topology changes)
2. **B._value stays current** across all mode transitions (tap fires regardless)
3. **Values are not duplicated** during transition (no replay artifacts)
4. **STANDALONE resumes correctly** when all external subscribers leave

### Diamond topology with output slots

The bitmask must still resolve correctly even though B's output slot (not B directly) dispatches to C.

```ts
// C depends on [A, B] where B depends on A — diamond
const a = state(1)
const b = derived([a], () => a.get() * 2)
const c = derived([a, b], () => a.get() + b.get())

// C should compute exactly once per a.set()
let cCount = 0
effect([c], () => { cCount++ })

a.set(5)
expect(cCount).toBe(1)      // once, not twice
expect(c.get()).toBe(15)     // 5 + 10

// Verify with multiple subscribers to B (MULTI mode)
const unsub = subscribe(b, () => {})
a.set(10)
expect(cCount).toBe(2)      // still once per change
expect(c.get()).toBe(30)     // 10 + 20
unsub()
```

### Status model correctness

Verify the full status lifecycle including terminal states:

```ts
const a = state(1)
const b = derived([a], () => a.get() * 2)

// SETTLED after data flows
a.set(2)
expect(b._status).toBe('SETTLED')

// DIRTY during two-phase push (observable via effect timing)
let statusDuringEffect: string | undefined
const c = derived([a], () => a.get())
effect([a], () => {
  // During effect, c should be DIRTY or SETTLED depending on ordering
  statusDuringEffect = c._status
})

// COMPLETED on terminal
const p = producer<number>(({ emit, complete }) => {
  emit(1)
  complete()
})
const sub = subscribe(p, () => {})
expect(p._status).toBe('COMPLETED') // or verify via Inspector
```

### Type 3 tuple signals

Verify that `[Symbol, data?]` tuples are forwarded unchanged through nodes that don't recognize them:

```ts
// Unknown type 3 signals must pass through — forward-compatibility
const a = state(1)
const b = derived([a], () => a.get())

const customSignal = Symbol('CUSTOM')
const received: any[] = []

// Raw sink observing type 3
b.source(START, (type: number, data: any) => {
  if (type === STATE) received.push(data)
})

// Inject custom signal through a — should arrive at b's sink
// (implementation-specific: may need to inject via a's internal sink)
```

### Raw callbag sink wrapper

Prefer `Inspector.observe()` over raw callbag sinks for test assertions. Use raw sinks only when testing protocol-level behavior that `observe()` can't capture (e.g., talkback mechanics):

```ts
// Inspector.observe() captures DATA, STATE, and END — covers most test needs
const a = state(1)
const obs = Inspector.observe(a)

a.set(2)
obs.values    // [2]
obs.signals   // [DIRTY]
obs.ended     // false
```

### init() timing: construction vs connection

Test that handler-local state resets on reconnect but dep connection structure survives:

```ts
// Operator with a counter (handler-local state)
const a = state(0)
const counted = operator([a], (actions) => {
  let count = 0 // handler-local: resets on reconnect
  return (depIndex, type, data) => {
    if (type === DATA) {
      count++
      actions.emit([data, count])
    }
  }
})

const values1: any[] = []
const unsub1 = subscribe(counted, v => values1.push(v))
a.set(1); a.set(2)
expect(values1).toEqual([[1, 1], [2, 2]])
unsub1()

// Reconnect — count resets
const values2: any[] = []
const unsub2 = subscribe(counted, v => values2.push(v))
a.set(3); a.set(4)
expect(values2).toEqual([[3, 1], [4, 2]]) // count restarted at 1
unsub2()
```

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

## Completed Test History (Batch Summary)

All batches are complete. 267 tests were written across 8 batches. 12 bugs were found and fixed.

| Batch | Focus | Tests | Fixes |
|-------|-------|-------|-------|
| 1 | first/last/find/elementAt/partition | 42 | 3 |
| 2 | Source factories + buffer error/completion | 31 | 3 |
| 3 | Core primitives edge cases | 45 | 1 |
| 4 | Reconnect/lifecycle across all operators | 26 | 0 |
| 5 | Reentrancy, stress, complex chains | 29 | 1 |
| 6 | Protocol, batch, interop | 27 | 0 |
| 7 | flat/switchMap/repeat/pipeRaw/SKIP/Inspector | 39 | 2 |
| Post | Optimization pass & code review | 28 | 2 |
| **Total** | | **267** | **12** |

### Notable bugs found

| Batch | Operator | Bug | Fix |
|-------|----------|-----|-----|
| 1 | first, find, elementAt | Upstream error converted to completion | `data !== undefined` check → `error(data)` |
| 2 | fromPromise | Rejection silently swallowed | Rejection handler calls `error(reason)` |
| 2 | fromObs | Missing error/complete in observer | Observer now passes `{ next, error, complete }` |
| 2 | buffer | Upstream error/completion ignored | Added `onEnd` handlers for input and notifier |
| 3 | effect | dispose() not idempotent | Added `_disposed` guard |
| 5 | producer | retry can't restart completed sources | Added `resubscribable` option + reentrancy fix |
| 7 | flat | Sync inner completion race | Added `innerEnded` flag guard |
| 7 | switchMap | Same sync completion race | Same fix |
| Post | operator | complete()/error() didn't disconnect upstream | Added upstream END loop before notifying sinks |
| Post | operator | init-time complete() leaked dep subscriptions | Added `if (completed) break` in dep loop |

### Watch list

- `derived` and `effect` send END back to the dep that just sent them END (in the upstream-disconnect loop). For standard producers/derived this is safe (talkback guards against double-END). A custom callbag source that doesn't guard could misbehave. Add a regression test if this is ever observed.
