---
SESSION: lazy-tier2-option-d3
DATE: March 18, 2026
TOPIC: Architecture pivot — Lazy Tier 2 operators with overloaded initial (Option D3), derived disconnect-on-last-unsub
---

## KEY DISCUSSION

### 1. The switchMap Footgun Revisited

From SESSION-docs-site-patterns-streamFrom: the 5-operator streaming tax exists because switchMap eagerly evaluates `fn(outer.get())` at construction to provide an initial value. For `state('')`, this calls `fn('')` immediately, creating an inner producer whose initial value is `undefined`. This `undefined` leaks through scan.

The prior session proposed `streamFrom`/`cancellable` patterns to hide this. This session asks: **should we fix the root cause instead?**

### 2. Four Options Evaluated

| Option | Description | Key trade-off |
|---|---|---|
| A (status quo) | Keep eager evaluation, hide with patterns | Footgun remains; patterns are band-aids |
| B (fully lazy) | No computation until subscribed, no sync get() | Breaks `Store<T>.get()` contract for state/derived |
| C (hybrid) | Lazy connection, on-demand get() reconnects | Risk: leaks emission at instant of reconnection during talkback handshake |
| **D (lazy + initial)** | Tier 2 lazy until subscribed, explicit `initial` for pre-subscription get() | Matches TanStack Query / SWR / Solid `createResource` |

**Option C rejected:** When a sink connects to a disconnected derived, reconnection triggers upstream subscriptions which could fire synchronous DATA before the sink's talkback handshake completes. Race condition.

**Option D chosen** with D3 sub-variant (TypeScript overloads for `initial`):

```ts
// No initial → B | undefined (honest type)
function switchMap<A, B>(fn: (a: A) => Store<B>): StoreOperator<A, B | undefined>
// With initial → B (clean type)
function switchMap<A, B>(fn: (a: A) => Store<B>, opts: { initial: B }): StoreOperator<A, B>
```

### 3. Philosophy Alignment

User quote: "reactive stream that happens to cache its latest value" — aligns with the project slogan 川流不息，唯取一瓢 ("Take one scoop from flowing water"). A Tier 2 operator's value doesn't exist until the stream produces one.

**Key realization:** `ProducerStore<T>` already extends `Store<T | undefined>`. The "always has a value" contract only applies to `state` and `derived`. Tier 2 operators built on `producer()` already allow `undefined` in the type. The lazy change doesn't break any contract.

### 4. Derived Changes

**Disconnect on last unsubscribe:** Remove `D_STANDALONE` perpetual connection. When all subscribers leave, derived disconnects from upstream. Status → DISCONNECTED.

**get() always pull-computes when disconnected:** Calls `_fn()` which reads deps via `dep.get()`. Always returns fresh value. No stale cache concern. This makes `resetOnTeardown` meaningless for derived (both paths end at `_fn()`), so it was removed from derived. `resetOnTeardown` remains on `SourceOptions` for producer/operator where it resets `_value` to `initial`.

**Amendment (post-review):** The original spec said "without resetOnTeardown, get() returns stale cache." During implementation, always-fresh pull-compute was chosen instead — it's simpler and safer. Since both paths produce the same result, resetOnTeardown was removed from derived entirely.

### 5. DRY Concern

`fromPromise` and `fromAsyncIter` already exist as extras. The proposed `fromAsync`/`fromStream` patterns compose on top of them (+ switchMap + filter + loading/error stores). They belong in `patterns/`, not `extra/`. No duplication.

### 6. Naming Decision

`cancellable` → `fromAsync`, `streamFrom` → `fromStream`. Parallels existing `from___` convention (`fromPromise`, `fromAsyncIter`, `fromEvent`). Implementation deferred to after D3 lands.

### 7. Raw Callbag Extras

Two extras implement raw callbag protocol directly:
- **`subject.ts`** — manual `source()` with output slot management. **Reviewed: fully compatible with D3.** Subject has no upstream deps — it's manually driven via `next()/error()/complete()`. When all sinks leave, status → DISCONNECTED (line 146/150). No interaction with derived's disconnect-on-unsub changes. No changes needed.
- **`wrap.ts`** — interop bridge for external callbag sources/operators. Raw protocol is intentional (interop boundary). Leave as-is.

### 8. Refactor Scope

| What | Change | Lines |
|---|---|---|
| `switchMap.ts` | Remove eager `fn(outer.get())`. Lazy start. Add `initial` overload. | ~20 |
| `concatMap.ts` | Same lazy pattern. Added `maxBuffer` option for queue backpressure. | ~15 |
| `exhaustMap.ts` | Same lazy pattern. | ~10 |
| `flat.ts` | Same lazy pattern. Added `initial` overload. | ~15 |
| `derived.ts` | Disconnect on last unsub. Pull-compute on get(). No resetOnTeardown (removed). | ~25 |
| `rescue.ts` | Changed `{ initial: input.get() }` → `{ getter: () => input.get() }` for D3 compat. | 1 |
| `retry.ts` | Same getter fix. | 1 |
| `subject.ts` | Reviewed — no changes needed (no upstream deps, fully compatible). | 0 |
| `producer.ts` | No change (already supports initial + resetOnTeardown) | 0 |
| `state.ts` | No change | 0 |
| Tests | Update switchMap tests, add lazy behavior tests | TBD |

## REJECTED ALTERNATIVES

- **Option A (status quo + patterns):** Treats symptom, not cause. Every Tier 2 operator would need pattern wrappers.
- **Option B (fully lazy, no sync get):** Breaks `Store<T>.get()` for state/derived. Too disruptive.
- **Option C (hybrid reconnect-on-get):** Reconnection race condition during talkback handshake.
- **Derived resetOnTeardown:** Removed — with always-fresh pull-compute, both paths (with and without reset) produce the same result. No-op flag.
- **Derived stale cache on get():** Considered but rejected — always-fresh pull-compute is simpler and avoids staleness bugs.
- **Fix switchMap eagerness only (no derived change):** Incomplete. Derived staying connected forever after first touch wastes memory.

## KEY INSIGHTS

1. **ProducerStore<T> already extends Store<T | undefined>.** The "always has value" concern was a false constraint — it only applies to state and derived, not Tier 2.
2. **Option D matches established patterns.** TanStack Query `initialData`, SWR `fallbackData`, Solid `createResource` initial — LLMs already know this pattern.
3. **The streaming example drops from 5 operators to 3.** `filter(undefined)` after switchMap is no longer needed. The footgun is killed at the root.
4. **Derived disconnect-on-last-unsub is a memory win.** Unused derived nodes no longer hold upstream connections forever.

## IMPLEMENTATION PLAN

1. Refactor `switchMap.ts` — lazy inner evaluation, `initial` overload
2. Refactor `derived.ts` — disconnect on last unsub, `resetOnTeardown` support
3. Review `subject.ts` for compat
4. Apply lazy pattern to other Tier 2 operators
5. Update tests
6. Update `examples/streaming.ts` to use simplified 3-operator form

---END SESSION---
