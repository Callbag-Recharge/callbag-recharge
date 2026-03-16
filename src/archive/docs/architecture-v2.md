# Architecture v2 — Two-Phase Push

This document describes the target architecture for callbag-recharge's next major refactor. The goal is to unify data transport through callbag (eliminating the dual-channel design) while maintaining glitch-free diamond resolution.

## Motivation

### Current design: push DIRTY, pull values (dual-channel)

The v1 architecture uses two separate channels:
- **Callbag channel:** Carries only the `DIRTY` sentinel via `sink(DATA, DIRTY)`
- **Direct call channel:** Values are read via `store.get()`, which bypasses callbag entirely

This works but creates an inelegant split. Callbag is already used for wiring pipes and effects, yet actual data never flows through it. The `get()` function is a side-channel that operates outside the reactive graph.

Additionally, the v1 `derived.get()` always recomputes — there is no caching. This is simple but wasteful when a derived store is read multiple times between changes.

### Why not pull-based refresh? (Preact Signals, SolidJS)

Both Preact Signals and SolidJS use a similar dual-channel pattern: push dirty notifications, pull values via lazy refresh. The difference from our v1 is that they cache computed values and use a dirty flag to avoid redundant recomputation on pull.

We considered adopting this model but chose a different path: **two-phase push**. Rather than pulling values lazily on read, values are pushed through the callbag graph after DIRTY propagation completes. This keeps callbag as the single data transport mechanism and makes batching/memoization natural.

### Target design: two-phase push (single channel)

All data flows through callbag. The protocol has two phases per change cycle:

1. **Phase 1 — DIRTY propagation:** Identical to v1. `DIRTY` fans out through the entire downstream graph. Each node counts how many of its upstream deps sent DIRTY.
2. **Phase 2 — Value propagation:** Source nodes emit their new values through callbag sinks. Each downstream node buffers incoming values, waiting until all dirty deps have delivered. Once all dirty deps are resolved, the node computes its new value and emits downstream.

Values are cached. `get()` returns the cached value and **blocks** (throws or returns a sentinel) during the window between DIRTY arrival and value resolution.

---

## Two-phase push protocol

### Phase 1: DIRTY propagation

Same as v1. When `state.set(newVal)` is called:

1. Store the new value internally (but don't emit yet)
2. Push `DIRTY` to all callbag sinks
3. DIRTY propagates depth-first through the graph
4. Each derived node receiving DIRTY increments its `pendingCount` and records which upstream dep sent it
5. Effects/subscribers are enqueued (same as v1 via `enqueueEffect`)

After all DIRTY has propagated (depth reaches 0), phase 2 begins.

### Phase 2: Value propagation

After DIRTY propagation completes:

1. All changed state stores emit their new values to their callbag sinks: `sink(DATA, newValue)`
2. Derived nodes receive values from upstream:
   - Buffer the value, decrement `pendingCount`
   - When `pendingCount` reaches 0 (all dirty deps resolved): compute `fn()` using received values + cached values from non-dirty deps
   - Emit the computed value to own sinks
   - Cache the computed value for future `get()` calls
3. Effects/subscribers receive the final values and run

### Diamond resolution

```
state A → derived B → derived D → effect
         ↘ derived C ↗
```

**Phase 1:**
1. A pushes DIRTY to B, C
2. B forwards DIRTY to D → D.pendingCount = 1, from B
3. C forwards DIRTY to D → D.pendingCount = 2, from B and C

**Phase 2:**
4. A emits value to B's sink, C's sink
5. B receives value, computes, emits to D. D has 1/2 — waits.
6. C receives value, computes, emits to D. D has 2/2 — computes, emits.

D computes exactly once with both B and C fully resolved. No glitch.

### Batch interaction

```ts
batch(() => {
  a.set(1)   // Phase 1 only: DIRTY propagates, value queued
  b.set(2)   // Phase 1 only: DIRTY propagates, value queued
})            // Phase 2: all queued values emit together
```

During a batch:
- Each `set()` call stores the new value and pushes DIRTY (phase 1)
- Value emission (phase 2) is deferred until the batch ends
- After the outermost batch completes: all changed states emit their values, triggering the value propagation wave
- Effects flush after value propagation completes

This naturally coalesces multiple state changes — derived nodes count dirty deps across all changes in the batch and resolve once.

---

## Derived stores: cached values

In v2, derived stores cache their computed value. This is a departure from v1 where `derived.get()` always recomputes.

**Value lifecycle:**
1. On creation (or first subscription): compute and cache initial value
2. On receiving DIRTY: mark as pending (cache is stale but preserved)
3. On receiving all expected values: recompute, update cache, emit downstream
4. On `get()`: return cached value (or block if pending)

**Memoization with `equals`:**
After recomputation, if `equals(cachedValue, newValue)` returns true:
- Keep the cached reference (reference stability)
- **Do not emit to downstream sinks** — this is the push-phase memoization that v1 couldn't do
- Downstream nodes that were counting this dep as dirty decrement their `pendingCount` without receiving a value change (a "no-change" resolution signal, or simply emit the unchanged value so downstream can proceed)

This replaces the v1 limitation where `equals` on derived was pull-phase only. In v2, `equals` on derived becomes a true DIRTY barrier — it suppresses unnecessary downstream computation at the push phase.

---

## `get()` semantics

### Resolving during pending state

In v2, `get()` returns the cached value when the store is settled. During the window between DIRTY arrival and value resolution (pending state), `get()` recomputes on demand by calling `fn()` — which recursively pulls through the dep chain (states are always settled, pending deriveds recompute recursively). This preserves the v1 guarantee that `get()` always returns a consistent value.

- `get()` on a connected, settled store: returns cached value (fast, no computation)
- `get()` on a connected, pending store: recomputes on demand (recursive pull). The result is NOT cached — phase 2 handles proper cache update and sink emission.
- `get()` on an unconnected store: always recomputes (v1 lazy semantics, no cache)

### Rationale

Throwing on pending `get()` was considered but rejected — it forces callers to handle an error for a condition that can be resolved synchronously. Since deps' `get()` recursively resolves (states always have their value set before DIRTY propagates, pending deriveds recompute), the pull always succeeds. The tradeoff: a pending `get()` may recompute a value that phase 2 will recompute again moments later. This is rare in practice — `get()` during propagation only happens from imperative code outside the reactive graph.

### Future: JSX/template integration

For framework integration (e.g., JSX), stores could auto-subscribe in template expressions:

```tsx
// Future hypothetical API
<p>The count is {count}</p>  // auto-subscribes, re-renders on change
```

This would use the callbag subscription mechanism, not `get()`. The blocking `get()` is for imperative code that needs a snapshot; reactive rendering uses subscriptions.

---

## Impact on existing primitives

### `state`
- `set()`: stores value, pushes DIRTY (phase 1). After propagation, emits value (phase 2).
- `get()`: returns `currentValue` (always settled — state is a source of truth)

### `derived`
- Caches computed value (new in v2)
- On DIRTY: increments `pendingCount`, records which dep
- On value from dep: buffers value, decrements `pendingCount`. When 0: recompute, cache, emit.
- `get()`: returns cache if settled, blocks if pending
- `equals`: if recomputed value equals cached, emit unchanged value (so downstream can resolve) but downstream can detect no-change

### `stream`
- Largely unchanged — producer emits values that become the cached value
- `get()`: returns last emitted value (or undefined if none)

### `effect`
- Receives DIRTY in phase 1, enqueued as before
- In phase 2, receives values from deps through callbag sinks
- Runs after value propagation completes (same timing as v1 flush)
- `fn()` can read settled values from deps via `get()` — all deps are resolved when effect runs

### `subscribe`
- Same as effect — receives values through callbag, runs after resolution

### `pipe` / `pipeRaw`
- `pipe()`: each operator is a derived store, now with caching and two-phase semantics
- `pipeRaw()`: single fused derived store. Input memoization is now naturally built-in — if the source emits the same value, the fused transforms can be skipped entirely

### `batch()`
- Phase 1 runs during the batch (DIRTY propagation for each `set()`)
- Phase 2 deferred until batch ends (all changed states emit together)
- Effects flush after phase 2 completes

---

## Impact on extra modules

Extra modules that are callbag operators/sources need to participate in the two-phase protocol:

**Sources** (`interval`, `fromIter`, `fromEvent`, `fromPromise`, `fromObs`):
- These are value producers, similar to `stream`. They push values directly — no DIRTY phase needed since they are leaf sources.

**Operators** (`take`, `skip`, `merge`, `combine`, `concat`, `flat`, `share`, `map`, `filter`, `scan`):
- These sit in the middle of the graph. They need to handle both DIRTY (phase 1) and value (phase 2) signals from upstream.
- `combine` is the most interesting — it naturally handles the diamond case by counting dirty deps and waiting for all values.
- `map`, `filter`, `scan`: receive DIRTY, then receive value. On value: transform and emit downstream.

**Sinks** (`forEach`):
- Terminal nodes. Receive DIRTY (enqueue), receive value (run callback).

### Glitch behavior in extras (part 2 concern)

The v2 core (state, derived, effect, subscribe) is glitch-free in diamond topologies. Extras, however, fall into three categories with different glitch guarantees:

#### 1. Simple passthrough extras — glitch-free (done)

`take`, `skip`, `tap`, `remember`, `pairwise`, `distinctUntilChanged`

These are structurally equivalent to single-dep derived nodes. They participate in two-phase by using raw callbag to forward DIRTY in phase 1 and emit transformed values in phase 2. They use a `dirty` flag to coalesce batch DIRTYs (same role as derived's `dirtyDeps` Set for a single dep). They forward upstream END to downstream sinks, matching the standard callbag convention.

The pattern (simplified — actual implementations add operator-specific logic):
```ts
input.source(START, (type, data) => {
	if (type === DATA) {
		if (data === DIRTY) {
			if (!dirty) {
				dirty = true;
				// Phase 1: forward DIRTY to downstream
				for (const sink of sinks) sink(DATA, DIRTY);
			}
		} else if (dirty) {
			dirty = false;
			// Phase 2: transform and emit value
			currentValue = transform(data);
			for (const sink of sinks) sink(DATA, currentValue);
		}
	}
	if (type === END) {
		// Forward upstream completion to downstream sinks
		for (const sink of sinks) sink(END, data);
	}
});
```

**`tap` timing note:** `tap`'s side-effect function runs synchronously inline during phase 2 value delivery, matching the behavior of both callbag-tap and RxJS tap. This differs from the old subscribe-based implementation where fn() was deferred to the effect flush phase.

#### 2. Time-based extras — inherently glitchy

`debounce`, `throttle`, `delay`, `timeout`, `bufferTime`, `buffer`, `sample`

These use timers (`setTimeout`/`setInterval`) that fire outside any propagation cycle. Their value emissions always start a new DIRTY+value cycle via `pushChange()`. This is correct behavior — like RxJS, time-based operators are natural glitch boundaries.

#### 3. Complex mapping extras — glitchy, hard to fix

`switchMap`, `flat`, `concatMap`, `exhaustMap`, `rescue`, `retry`

These manage inner subscription lifecycles. The outer value triggers creation of a new inner source, whose initial value becomes the output. Making these fully two-phase-aware would require tracking dirty state across inner/outer subscription boundaries — the outer DIRTY means "my output will change" but the actual output value depends on the inner source which may not exist yet.

For now, these follow the RxJS model: glitches are possible when these operators appear in diamond topologies alongside direct paths from the same source. In practice this topology is uncommon — these extras typically wrap independent async sources, not branches of a shared state graph.

**Current implementation detail:** Raw-callbag extras (rescue, retry) have empty `if (data === DIRTY) {}` handlers that swallow DIRTY. subscribe()-based extras (switchMap, flat, etc.) use subscribe for the outer and raw callbag for the inner, with the same swallow pattern on the inner. Both call `pushChange()` to emit values, starting a new cycle.

---

## Comparison with established signal libraries

| Aspect | v1 (current) | v2 (target) | Preact Signals | SolidJS |
|---|---|---|---|---|
| Data transport | Dual: DIRTY via callbag, values via get() | Single: both via callbag | Dual: flags via notify, values via refresh | Dual: flags via notify, values via updateIfNecessary |
| Derived caching | No cache (always recompute) | Cached, updated on value arrival | Cached, lazy recompute on read | Cached, lazy recompute on read |
| Diamond solution | Deferred pull after DIRTY propagation | Two-phase push with dep counting | Recursive depth-first refresh | Height-based topological sort |
| `get()` during propagation | Always works (recomputes) | Recomputes if pending (not cached) | Always works (triggers refresh) | Always works (triggers recompute) |
| Memoization | Pull-phase only (equals on derived) | Push-phase (equals suppresses downstream) | Push-phase (version check) | Push-phase (equality check) |
| Batching | Defers effects only | Defers value emission + effects | Defers effects only | Defers effects; Solid 2.0 defers writes |

---

## Migration plan

### Phase 1: Core refactor ✅
1. ✅ Add caching + pending state to `derived`
2. ✅ Change `state.set()` to two-phase: push DIRTY, then emit value after propagation
3. ✅ Update `protocol.ts` to orchestrate phase 1 → phase 2 transition
4. ✅ Update `effect` and `subscribe` to receive values via callbag sinks
5. ✅ Make `get()` recompute on demand if pending (not blocking — see rationale above)
6. ✅ Update `equals` on derived to suppress downstream emission (push-phase memoization)

### Phase 2: Extra modules (partially done)
7. ✅ Rewrite simple passthrough extras (`take`, `skip`, `tap`, `remember`, `pairwise`, `distinctUntilChanged`) as raw-callbag two-phase nodes — forward DIRTY, emit transformed values. Glitch-free in diamond topologies. END forwarded from upstream to downstream (matches callbag convention).
8. Update `combine` to use natural dep counting (replaces ad-hoc glitch prevention)
9. Update sources and sinks
10. ✅ Time-based extras (`debounce`, `throttle`, `delay`, `timeout`, `bufferTime`, `buffer`, `sample`) keep `pushChange()`-based implementation — they are natural glitch boundaries.
11. ✅ Complex mapping extras (`switchMap`, `flat`, `concatMap`, `exhaustMap`, `rescue`, `retry`) keep current implementation — glitches accepted in diamond topologies (same as RxJS).

### Phase 3: Validation (partially done)
12. ✅ Update all tests for new semantics (blocking `get()`, cached derived)
13. ✅ Add diamond-topology tests for passthrough extras to verify glitch-free behavior
14. ✅ Document glitch boundaries for time-based and complex extras (in test sections 5, 7, 8)
15. Benchmark against v1 to verify no regression
16. ✅ Update documentation

---

## Test inventory

### Existing tests (`two-phase.test.ts`) — added in Phase 1

These tests verify the core two-phase protocol and current extra behavior. They use strict `toEqual` assertions for exact emission order and count.

**Two-phase protocol — raw callbag signals (5 tests):**
- state: `[DIRTY, value]` per `set()`
- derived: single `[DIRTY, value]` per dep change
- derived with multiple deps in batch: single `[DIRTY, value]`
- stream: `[DIRTY, value]` per `emit()`
- subject: `[DIRTY, value]` per `next()`

**Diamond topology — core glitch-free (7 tests):**
- derived computes exactly once in simple diamond
- batch + diamond = single computation
- deep diamond chain (4 levels): no intermediate glitches
- effect fires exactly once per change in diamond
- subscribe fires exactly once per change in diamond
- `equals` suppresses unchanged values
- `equals` suppression in diamond: downstream sees suppressed value but still recomputes for changed deps

**Emission counts — raw-callbag passthrough extras (7 tests):**
- take: fires exactly n times
- skip: fires exactly (total - n) times
- distinctUntilChanged: exact duplicate suppression
- tap: fires same count as upstream
- remember: fires same count as upstream
- pairwise: fires on each change after first
- subject: fires per distinct `next()`

**Emission counts — complex extras (4 tests):**
- switchMap: exact sequence on outer+inner changes `[11, 20, 21]`
- flat: exact sequence on inner switch `[11, 20, 21]`
- rescue: includes fallback initial value `[99, 100]`
- retry: exact producer count across retries

**Re-entrancy and batch ordering (4 tests):**
- `state.set()` inside subscribe callback: correct order
- batch coalesces: single emission for final value
- nested batch: defers until outermost
- effect-triggered state change: derived recomputes correctly

**Diamond topology — extras glitch boundaries (3 tests):**
- tap in diamond: correct values on both paths
- switchMap: correct final value
- sample: fires only on notifier

### Tests added in Phase 2

**Passthrough extras — two-phase protocol verification (6 tests):**
- take forwards `[DIRTY, value]` at raw callbag level
- skip forwards `[DIRTY, value]` after skip phase (silent during skip)
- tap forwards `[DIRTY, value]` at raw callbag level
- remember forwards `[DIRTY, value]` at raw callbag level
- pairwise forwards `[DIRTY, value]` at raw callbag level
- distinctUntilChanged forwards `[DIRTY, value]` (emits cached value on duplicate for resolution)

**Passthrough extras — diamond glitch-free (6 tests):**
- take in diamond: derived downstream computes exactly once
- skip in diamond: derived downstream computes exactly once
- tap in diamond: derived downstream computes exactly once
- pairwise in diamond: derived downstream computes exactly once
- distinctUntilChanged in diamond: derived downstream computes exactly once
- remember in diamond: derived downstream computes exactly once

**Complex extras — diamond glitch documentation (3 tests):**
- switchMap in diamond: documents exact fire count (may be >1), verifies correct final value
- flat in diamond: documents exact fire count, verifies correct final value
- rescue in diamond: documents exact fire count, verifies correct final value

### Tests still to add

**Time-based extras — isolation tests:**
- debounce/throttle/delay: verify `pushChange` fires independently of any propagation cycle
- Verify downstream derived recomputes correctly after timer-based emission
