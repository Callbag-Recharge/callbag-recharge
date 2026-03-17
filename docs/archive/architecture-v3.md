# Architecture & Implementation Guide

This document is the definitive reference for implementing and maintaining callbag-recharge. Read it before writing any new primitive, operator, or extra. This is the implementation law.

---

## 1. Core Principles

These are inviolable. Any implementation that breaks one of these is wrong, regardless of whether tests pass.

1. **Type 1 DATA carries only real values.** Never sentinel objects, never `undefined` as a signal. `DIRTY`, `RESOLVED`, and future control signals live exclusively on type 3 STATE.

2. **Type 3 STATE is forwarded, not swallowed.** Every node that doesn't fully understand a type 3 signal must forward it downstream. Unknown signals pass through. This ensures compatibility with future signals (PAUSE, RESUME) without changing existing code.

3. **DIRTY before DATA, always.** A node must send `signal(DIRTY)` before it sends `emit(value)`. This is the two-phase push protocol. `autoDirty: true` on producer handles this automatically. Manual producers and raw callbag operators must do it themselves.

4. **RESOLVED means "I was dirty, value didn't change."** Send RESOLVED only if a prior DIRTY was sent from the same node in the same cycle. Never send RESOLVED without a preceding DIRTY. Never send RESOLVED to suppress a value you never promised.

5. **Every resource allocation has a matching deallocation.** Timers, subscriptions, talkbacks, inner loops — all must be cleaned up on teardown. The cleanup path is called on: last sink disconnect, `complete()`, and `error()`.

6. **Completion is terminal.** After a node completes or errors, it emits nothing further. `_flags & P_COMPLETED` / `O_COMPLETED` / `D_COMPLETED` guard every emit/signal path. Exception: `resubscribable` producers can restart when re-subscribed after completion with no active sinks.

7. **Effects run inline.** There is no `enqueueEffect`. When all dirty deps of an effect have resolved (either DATA or RESOLVED), the effect function runs synchronously in the same call stack. No global scheduler.

8. **Batch defers DATA, not DIRTY.** During `batch()`, type 3 DIRTY propagates immediately and synchronously through the entire graph. Type 1 DATA emissions are deferred until the outermost batch exits. This is why diamond resolution works in batches — the full dirty state is established before any value flows.

9. **Dep identity, not version numbers.** Derived nodes track which deps are dirty via a bitmask (dep index = bit position). Multiple DIRTYs from the same dep are idempotent. DATA from a dep removes that dep's bit. When the bitmask reaches 0, all deps have resolved.

10. **Compatibility targets: TC39 Signals, raw callbag, RxJS semantics.** When in doubt about operator behavior, check RxJS. When in doubt about equality/dedup behavior, check TC39 Signal.State (equals defaults to `Object.is`). When in doubt about protocol, check callbag-spec.

---

## 2. Folder & Dependency Hierarchy

```
src/
├── core/           ← primitives only — no extra/ imports allowed here
│   ├── protocol.ts ← DIRTY, RESOLVED, batch, deferStart — no other core imports
│   ├── types.ts    ← Store, WritableStore, Actions, etc. — no runtime imports
│   ├── inspector.ts← observability singleton — imports protocol only
│   ├── producer.ts ← imports protocol + inspector + types
│   ├── state.ts    ← imports producer + types (inherits inspector via ProducerImpl)
│   ├── operator.ts ← imports protocol + inspector + types
│   ├── derived.ts  ← imports protocol + inspector + types
│   ├── effect.ts   ← imports protocol + types (no store = no inspector)
│   └── pipe.ts     ← imports derived + types (map/filter/scan sugar)
├── extra/          ← operators, sources, sinks — may import from core only
│   ├── index.ts    ← barrel, no logic
│   └── *.ts        ← individual extras
└── index.ts        ← public API barrel — re-exports core
```

**Strict rules:**
- `core/` files never import from `extra/`
- `extra/` files import from `core/` but never from each other (circular risk)
- `protocol.ts` and `types.ts` have zero runtime dependencies on other core files
- Inspector is imported directly by `producer`, `operator`, `derived` only. `state` inherits inspector registration through `ProducerImpl`'s constructor (`StateImpl extends ProducerImpl`). `effect` is a closure-sink with no `get()` or `source()` — it is not a store and is not registered.

---

## 3. Protocol: Type Constants & Signal Vocabulary

```ts
const START = 0;   // Callbag handshake. sink(START, talkback) or source(START, sink).
const DATA  = 1;   // Real values only. Never DIRTY, never undefined-as-signal.
const END   = 2;   // Completion (no data) or error (data = error object).
const STATE = 3;   // Control signals: DIRTY, RESOLVED. Future: PAUSE, RESUME.

const DIRTY    = Symbol("DIRTY");     // "My value is about to change."
const RESOLVED = Symbol("RESOLVED"); // "I was dirty but didn't change."
```

**Signal flow direction — the graph is a DAG:**
```
sources → operators → derived → effect   (DOWNSTREAM: DATA, DIRTY, RESOLVED, END)
sources ← operators ← derived ← effect   (UPSTREAM: talkback(END) = unsubscribe only)
```

No signal ever cycles. Upstream communication is exclusively `talkback(END)` for unsubscribing.

**Callbag handshake:**
```
source(START, sink)      // subscriber calls source — goes downstream
sink(START, talkback)    // source responds with talkback — goes downstream
talkback(DATA)           // pull request (rarely needed in push model) — goes upstream
talkback(END)            // unsubscribe — goes upstream
```

**Two-phase push:**
```
sink(STATE, DIRTY)       // phase 1: "prepare — I'm about to change" — downstream
sink(DATA, value)        // phase 2: "here is the new value" — downstream

sink(STATE, RESOLVED)    // alternative phase 2: "I was dirty, but value didn't change" — downstream
```

**Completion/error:**
```
sink(END)                // normal completion — downstream to sinks; then talkback(END) upstream to deps
sink(END, error)         // error completion — downstream to sinks; then talkback(END) upstream to deps
```

---

## 4. The Three Primitive Composition Rules

When implementing a new extra, choose the right building block in this order:

### Rule 1: Use `operator()` for tier 1 (synchronous, stateful transforms)

Use `operator()` when the extra:
- Transforms or filters values synchronously
- Needs to participate in diamond resolution (forward DIRTY/RESOLVED)
- Has static deps (known at creation time)

**`effect` cannot be used to build operators.** Effect is a terminal sink — it has no `get()` or `source()`, produces no store, and cannot be subscribed to by downstream nodes. Effect is always the end of a graph path, never a middle node.

```ts
// Template for a tier 1 single-dep operator
function myOp<A, B>(/* options */): StoreOperator<A, B> {
  return (input) => operator<B>([input], ({ emit, signal, complete, error, disconnect }) => {
    // init: runs once on first subscriber. Local state here resets on reconnect.
    let localState = initialState;

    return (depIndex, type, data) => {
      if (completed) return;                    // completed guard — ALWAYS first

      if (type === STATE) {
        if (data === DIRTY)    signal(DIRTY);   // forward downstream — every DIRTY from single dep
        else if (data === RESOLVED) signal(RESOLVED); // forward or absorb (see below)
        else signal(data);                      // forward unknown STATE — REQUIRED, no exception
      }
      if (type === DATA) {
        // Transform, filter, accumulate, etc.
        // If emitting:    emit(transformedValue)
        // If suppressing: signal(RESOLVED)  ← NEVER stay silent after a DIRTY was forwarded
      }
      if (type === END) {
        // 1. Stop processing (completed flag set by complete()/error())
        // 2. complete()/error() will: disconnect upstream (talkback(END)), then notify sinks downstream
        if (data !== undefined) error(data);
        else complete();
      }
    };
  }, { initial: /* if any */ });
}
```

**Multi-dep operators (combine, merge, partition):** Use bitmask dirty tracking identical to `derived` — forward DIRTY only on the first dirty dep, forward RESOLVED only when all bits clear. See §7.

**Primary + secondary deps pattern (`withLatestFrom`):** Some operators need multiple deps wired for diamond resolution but only emit when a specific "primary" dep (dep 0) fires DATA. Secondary deps (dep 1..N) provide context values but don't drive emissions. The pattern uses `operator()` with a full bitmask, but tracks whether the primary dep received DATA in the current cycle:

```ts
// Template for primary + secondary deps operator
function myOp<A, R>(others: Store<unknown>[], fn: (...args) => R): StoreOperator<A, R> {
  return (source) => {
    const allDeps = [source, ...others];
    return operator<R>(allDeps, ({ emit, signal, complete, error }) => {
      const dirtyDeps = new Bitmask(allDeps.length);
      let primaryReceivedData = false;

      return (dep, type, data) => {
        if (type === STATE) {
          if (data === DIRTY) {
            const wasClean = dirtyDeps.empty();
            dirtyDeps.set(dep);
            if (wasClean) { primaryReceivedData = false; signal(DIRTY); }
          } else if (data === RESOLVED) {
            if (dirtyDeps.test(dep)) {
              dirtyDeps.clear(dep);
              if (dirtyDeps.empty()) {
                primaryReceivedData ? emit(compute()) : signal(RESOLVED);
              }
            }
          } else { signal(data); }
        }
        if (type === DATA) {
          if (dep === 0) primaryReceivedData = true;  // only primary drives output
          dirtyDeps.clear(dep);
          if (dirtyDeps.empty()) {
            primaryReceivedData ? emit(compute()) : signal(RESOLVED);
          }
        }
        if (type === END) { data !== undefined ? error(data) : complete(); }
      };
    }, { initial: compute(), getter: () => compute() });
  };
}
```

This pattern ensures:
- **No diamond glitch:** bitmask waits for all deps (primary + secondary) to settle before computing, so secondary dep values are always current
- **No stale reads:** secondary deps are real deps wired into the reactive graph, not read via `.get()` on disconnected stores
- **Source-driven semantics:** only the primary dep's DATA triggers emission; secondary-only changes produce RESOLVED (suppression)

Use this pattern when an operator needs context from additional stores but should only emit when the main source changes. Do not use it when all deps should drive emissions equally (use `combine` instead).

**When to send RESOLVED vs emit:** If the operator decides not to emit a value in response to incoming DATA (filter rejects, distinctUntilChanged sees equal), it MUST send `signal(RESOLVED)` — not stay silent. Staying silent leaves downstream nodes waiting forever with a non-empty dirty bitmask.

### Rule 2: Use `producer()` for tier 2 (async, time-based, dynamic subscription)

Use `producer()` when the extra:
- Involves timers, promises, observables, inner subscriptions
- Is a natural cycle boundary (each output starts a new DIRTY+value cycle)
- Cannot participate in diamond resolution (upstream timing is unknown)

Tier 2 extras use `subscribe()` internally, which is a callbag sink that only sees DATA (type 1). Tier 2 nodes therefore never receive DIRTY/RESOLVED from upstream — they only receive values. Each `emit()` starts a new DIRTY cycle via `autoDirty: true`.

```ts
// Template for a tier 2 operator
function myOp<A, B>(/* options */): StoreOperator<A, B> {
  return (input) => producer<B>(({ emit, complete, error }) => {
    // Setup: subscribe to input, start timers, etc.
    const unsub = subscribe(input, (value, prev) => {
      // ... async logic ...
      emit(result); // autoDirty: true → sends DIRTY + DATA automatically (downstream)
    });

    return () => {
      // Teardown: clear timers, cancel promises, call unsub()
      unsub();
    };
  }, {
    initial: input.get(),  // prevents spurious re-emit on first subscribe
    equals: Object.is,     // prevents duplicate emissions
  });
}
```

**Always set `initial` and `equals` for dynamic-subscription operators.** Without `initial`, the first `subscribe()` inside the fn calls `emit()` with the current inner value — often a duplicate. `equals: Object.is` prevents it from broadcasting if unchanged.

**`resetOnTeardown: true`** — use when the operator's value should revert to undefined/initial on disconnect (e.g., `delay` — inflight values are canceled so `get()` should not return a stale value).

**`getter` option** — use when `get()` should return something other than the last emitted value (e.g., `sample` — `get()` returns the latest input value, not the last sampled value).

### Rule 3: Extend primitives (add option to producer/operator) before using raw callbag

If many operators share a pattern that can't be expressed with current options, add a new option to the primitive. Do not duplicate the same raw callbag boilerplate in 10 extras. Example: `resubscribable` was added when retry/rescue/repeat needed it.

**Raw callbag (no primitive) is a last resort** and should only appear in extras that:
- Need to detect inner completion/error separately from outer (e.g., retry listening for END on the inner source)
- Have no clean way to express the lifecycle via producer/operator options

---

## 5. Signal Handling Reference

### Directions

Every signal travels in exactly one direction:
- **DIRTY, RESOLVED, DATA, END(completion/error)** → **downstream** (toward sinks)
- **talkback(END)** → **upstream** (toward sources = unsubscribe)

### What each node MUST do with each incoming signal

| Signal | operator (single-dep) | operator (multi-dep) | derived | effect | tier-2 extra |
|--------|----------------------|---------------------|---------|--------|--------------|
| STATE DIRTY | Forward downstream on every DIRTY | Forward downstream on first dirty dep (bitmask: 0→nonzero); ignore subsequent (idempotent) | Forward downstream on first dirty dep (bitmask: 0→nonzero) | Track in dirty bitmask; do NOT forward | Not received (subscribe() sees only DATA) |
| STATE RESOLVED | Forward downstream, or absorb + send own RESOLVED if suppressing | Decrement bitmask; if 0 → forward RESOLVED downstream | Decrement bitmask; if 0 → send RESOLVED downstream | Decrement bitmask; if 0 → skip fn() | Not received |
| STATE (unknown) | **Must forward downstream** | **Must forward downstream** | **Must forward downstream** | Ignore (terminal, nothing downstream) | Not received |
| DATA | Transform/filter/accumulate → emit downstream or signal(RESOLVED) | Same; only act when dirty bitmask = 0 | Recompute when dirty bitmask = 0 → emit downstream or signal(RESOLVED) | Run fn() when dirty bitmask = 0 | Not received (subscribe() handles it externally) |
| END (completion) | 1. Set completed flag. 2. Disconnect upstream (talkback(END) to all deps). 3. Notify sinks downstream with END. | Same | Same | Run cleanup; disconnect from all dep talkbacks | Not received |
| END (error) | 1. Set completed flag. 2. Disconnect upstream (talkback(END)). 3. Notify sinks downstream with END(err). | Same | Same | Run cleanup; disconnect from all dep talkbacks | Not received |

**complete() / error() teardown sequence (operator, derived):**
```
complete() / error(e):
  → if completed: return                    // idempotency guard
  → completed = true
  → localTalkbacks = talkbacks
  → talkbacks = []                          // null upstream refs before acting
  → for each tb of localTalkbacks: tb(END) // disconnect upstream — goes upstream
  → localSinks = _sinks; _sinks = null     // null field before notifying
  → for each sink: sink(END) / sink(END,e) // notify downstream
```

### DATA without prior DIRTY ("raw callbag compat" rule)

Raw callbag sources have no concept of type 3 and never send DIRTY. When a dep sends DATA but never sent DIRTY for the current cycle, treat the DATA as simultaneously resolving that dep:

```ts
// Correct handling in derived/operator/effect handler:
if (type === DATA) {
  // Clear the dirty bit if it was set (normal case),
  // or leave bitmask unchanged if it wasn't (raw callbag case).
  dirtyDeps &= ~(1 << depIndex);

  // Only act when ALL known-dirty deps have resolved.
  if (dirtyDeps === 0) {
    recompute(); // fn() calls dep.get() to pull all dep values including raw ones
  }
  // If dirtyDeps !== 0: other deps are still dirty — wait.
  // The raw callbag dep's value will be captured by fn() via get() when we finally recompute.
}
```

**Diamond resolution still holds in mixed graphs.** Example: A→B (state, sends DIRTY), rawC (no DIRTY), D depends on [B, rawC]:

1. A sends DIRTY → B forwards DIRTY → D sets bit 0 (dirtyDeps = 0b01)
2. rawC sends DATA → D tries: `dirtyDeps &= ~(1<<1)` (bit 1 was 0, unchanged) → `dirtyDeps = 0b01 ≠ 0` → wait
3. A sends DATA → B recomputes → B sends DATA → D: `dirtyDeps &= ~(1<<0)` → `dirtyDeps = 0` → recompute. `fn()` calls `rawC.get()` and gets the already-updated value.

D computes once, correctly, with both deps resolved. The raw dep's DATA is implicitly captured at recompute time via `get()`.

**Note:** "forward unknown type" (the passthrough rule) is the mechanism for callbag-compat through intermediate operators. "DATA without prior DIRTY" is the mechanism for consuming raw callbag sources at the dep-tracking level. Both rules are required for full compatibility.

---

## 6. Lifecycle: Startup, Teardown, Cleanup, Reconnect

### Startup sequence (when first sink subscribes)

```
source(START, sink)
  → if completed + not resubscribable: sink(START, noop); sink(END); return  // downstream
  → add sink to _sinks
  → sink(START, talkback)             // handshake — downstream: sink gets talkback
  → deferStart(() => _start())        // connection batching: producer fn runs after full chain is wired
    → _start(): run ProducerFn or connectUpstream
    → initial value already in _value (from opts.initial) — no re-emit needed
```

**Connection batching (`deferStart`):** `beginDeferredStart()` / `endDeferredStart()` queues all producer fn starts. They all fire together at `endDeferredStart()`. This ensures that when `subscribe(store, cb)` is called, the cb captures the baseline value before any producer starts emitting. Without this, a producer that emits synchronously in its fn would race with the subscriber's initial read.

### Teardown sequence (last sink unsubscribes)

```
talkback(END)  ← upstream from sink
  → _sinks.delete(sink)
  → if _sinks.size === 0:
      _sinks = null
      _stop()
        → _flags &= ~P_STARTED
        → _cleanup?.()          // run user cleanup (clearInterval, unsub, etc.)
        → _cleanup = undefined
        → if resetOnTeardown: _value = _initial
```

### Completion/error sequence

```
complete() or error(e):
  → if _flags & P_COMPLETED: return   // idempotency guard
  → _flags |= P_COMPLETED
  → for each talkback: talkback(END)  // disconnect upstream — goes upstream
  → talkbacks = []
  → localSinks = _sinks; _sinks = null   // null field BEFORE notifying — reentrancy safe
  → _stop()                              // cleanup BEFORE notifying sinks
  → for each sink: sink(END) or sink(END, e)  // notify downstream
```

**Order matters:** cleanup before notification. This diverges from the callbag ecosystem convention (which notifies sinks first). The cleanup-first order ensures that if a sink re-subscribes during END notification (e.g., retry with `resubscribable: true`), the producer is already in a clean state (`_started = false`, no cleanup fn) so the new subscription starts fresh.

### Reconnect behavior

Reconnect = last sink disconnects → first sink subscribes again.

- **producer**: `_stop()` called on last disconnect, `_start()` called on new first subscriber. ProducerFn re-runs. All local state (timers, subscriptions) fresh. If `resetOnTeardown: true`, `_value` resets to `_initial`.
- **operator**: `_disconnectUpstream()` on last sink disconnect, `_connectUpstream()` on new subscriber. `init()` re-runs → all handler-local state resets.
- **derived**: same as operator — fresh dirty bitmask, recomputes from deps.
- **effect**: no reconnect. Effect connects once on creation and disposes. Create a new effect to reconnect.
- **Completed nodes** (after `complete()` or `error()`): cannot reconnect unless `resubscribable: true`. New subscribers get immediate START + END.

### dispose() idempotency

`dispose()` / `disconnect()` must be idempotent. Every major reactive library (RxJS, MobX, SolidJS, Vue, Preact Signals, Svelte) guarantees this. Implementation: check a `_disposed` flag at the top of dispose; set it before doing anything.

---

## 7. Dirty Tracking: Bitmask for Dep Charge

`derived`, multi-dep `operator`, and `effect` track which deps are dirty using a numeric bitmask. Each dep occupies one bit at position `depIndex`.

```ts
// depIndex 0 → bit 1 (1 << 0)
// depIndex 1 → bit 2 (1 << 1)
// depIndex 2 → bit 4 (1 << 2)

let dirtyDeps = 0;

// On STATE DIRTY from depIndex:
const bit = 1 << depIndex;
const wasClean = dirtyDeps === 0;
dirtyDeps |= bit;
if (wasClean) signal(DIRTY);          // first dirty dep → forward downstream

// On STATE RESOLVED from depIndex:
dirtyDeps &= ~(1 << depIndex);
if (dirtyDeps === 0) signal(RESOLVED); // all resolved without DATA → skip downstream

// On DATA from depIndex (covers both normal and raw callbag cases):
dirtyDeps &= ~(1 << depIndex);         // clear bit if it was set; no-op if it wasn't
if (dirtyDeps === 0) recompute();      // safe to act — all known-dirty deps resolved
```

**Bitmask limit:** 31 deps max (safe bit shifting in JS). If an operator needs more than 31 deps, use a `Set<number>` instead. No existing extra exceeds 31 deps.

**Multiple DIRTYs from same dep:** Idempotent — `|=` sets the bit regardless of whether it was already set. No double-forward of DIRTY.

**Single-dep operators:** No bitmask needed. Forward every DIRTY directly. The `if (wasClean)` check is only needed for multi-dep operators to avoid sending DIRTY multiple times.

---

## 8. Where to Put Guards, Stops, Passthroughs, and Switches

### Guard placement

Guards belong at the **top of the handler**, before any computation:

```ts
return (depIndex, type, data) => {
  if (completed) return;        // completed guard — FIRST, always
  if (type === STATE) { ... }   // then signals
  if (type === DATA) { ... }    // then data
  if (type === END) { ... }     // then completion
};
```

### Stop / disconnect timing

- **Disconnect from upstream immediately** when an operator decides it needs no more data (e.g., `take` after n values, `first` after one value). Call `disconnect()` or `disconnect(depIndex)` from inside the DATA handler, then call `complete()`. Don't wait for upstream to complete.
- **Disconnect from multiple deps** when only one is needed further (e.g., `takeUntil` disconnects source after notifier fires).

### Passthrough convention

Passthrough = operator forwards type 3 unchanged, transforms type 1:

```ts
if (type === STATE) signal(data);       // forward all STATE signals downstream — no exceptions
if (type === DATA)  emit(transform(data));
if (type === END)   data ? error(data) : complete();
```

**Never selectively forward STATE.** If you don't understand a STATE signal, forward it downstream. Only suppress DIRTY/RESOLVED when you have a semantic reason (e.g., filter absorbs upstream RESOLVED and sends its own RESOLVED after rejecting the value).

### Switch / dynamic upstream

Dynamic upstream (the upstream dep changes at runtime) is a tier 2 pattern. Use producer + inner subscribe. Never try to dynamically rewire operator deps — operator deps are static.

```ts
// Right: producer wrapping inner subscribe
return (outer) => producer<B>(({ emit, error, complete }) => {
  let innerUnsub: (() => void) | null = null;
  let innerEnded = false;                    // guard for sync inner completion

  function subscribeInner(store: Store<B>) {
    if (innerUnsub) { innerUnsub(); innerUnsub = null; }
    innerEnded = false;
    innerUnsub = subscribe(store, (v) => emit(v), {
      onEnd(err) {
        innerEnded = true;
        if (err) error(err);
        else handleInnerComplete();
      }
    });
    if (innerEnded) innerUnsub = null;       // sync completion race guard — REQUIRED
  }
  // ...
});
```

**The sync inner completion race:** When `subscribe()` is called and the inner source completes synchronously, the `onEnd` callback fires and nulls `innerUnsub` — but then `subscribe()` returns its unsub function and the caller assigns it to `innerUnsub`, overwriting the null. Always add the `innerEnded` flag guard after `subscribe()` returns.

---

## 9. Resource Allocation & Cleanup Checklist

Every tier 2 extra must clean up all of these if it uses them:

| Resource | Cleanup call |
|----------|-------------|
| `setInterval` | `clearInterval(id)` |
| `setTimeout` | `clearTimeout(id)` |
| `addEventListener` | `removeEventListener(event, handler)` |
| `subscribe()` return value | `unsub()` |
| Inner callbag talkback | `talkback(END)` — upstream |
| Inner store subscription | `innerUnsub?.()` |
| Pending promise (flag) | Set `cancelled = true` flag before returning |
| Observable subscription | `subscription.unsubscribe()` |

Cleanup is triggered by: the teardown return of ProducerFn, last sink disconnect, `complete()`, or `error()`. All paths must reach cleanup — verify by tracing all exit conditions.

---

## 10. Operator Behavioral Compatibility

### Default: follow RxJS

For any operator with an RxJS equivalent, match RxJS semantics exactly. When in doubt, read the [RxJS operator documentation](https://rxjs.dev/api). Do not guess — the semantics are specified there.

### Documented divergences from RxJS

These are places where callbag-recharge intentionally differs:

| Behavior | RxJS | callbag-recharge | Reason |
|----------|------|-----------------|--------|
| Value suppression | Operator simply emits nothing | Must send `signal(RESOLVED)` | Downstream nodes have dirty bitmasks that need clearing; silence causes deadlock |
| `filter` non-match | No emission | `signal(RESOLVED)` | Same as above |
| `distinctUntilChanged` equal | No emission | `signal(RESOLVED)` | Same as above |
| `share()` | Adds refcounting / multicasting | No-op (returns input unchanged) | Stores are inherently multicast — multiple `source(START, sink)` calls all receive data |
| Completion ordering | Notify sinks first, then cleanup | Cleanup first, then notify sinks | Allows `resubscribable` re-subscription during END notification; producer is already in clean state |
| `batch()` | No equivalent | Defers DATA, sends DIRTY immediately | Required for diamond resolution across multiple simultaneous state changes |
| `effect` execution | No equivalent (not an RxJS concept) | Inline, synchronous when deps resolve | No global scheduler; runs in the same call stack |
| `state` completion | N/A (TC39 Signals never complete) | Inherits completion from producer (callbag model) | Not a bug — state is a callbag source, not a pure TC39 Signal |

### TC39 Signals compatibility

`state` is compatible with TC39 Signal.State:
- `equals` defaults to `Object.is` (same as TC39's default)
- `set(same)` is a no-op (no emission, no DIRTY)
- `set()` during batch → DIRTY propagates immediately, value deferred

TC39 Signals have no concept of completion/error — they're infinite. Our `state` inherits completion from producer (it's a callbag), which is a deliberate divergence, not a bug.

### Raw callbag compatibility

Type 1 must be pure values. Any raw callbag consumer can subscribe to a callbag-recharge store and receive only real values on type 1. Any raw callbag source can be consumed by callbag-recharge via `fromObs` or direct `source(START, sink)` — DATA without DIRTY is handled via the bitmask rule in §5.

---

## 11. Optimization Guidelines

### V8 hidden class: use classes for hot primitives

`ProducerImpl`, `OperatorImpl`, `DerivedImpl` are V8 classes (not closures) so that V8 can build a stable hidden class. All instance properties are declared in the constructor with consistent types. Never add properties dynamically.

```ts
// Good: all properties initialized in constructor, same shape always
class ProducerImpl<T> {
  _value: T | undefined;
  _sinks: Set<any> | null = null;
  _flags: number;
  // ...
  constructor(...) {
    this._value = opts?.initial;
    // every property set here
  }
}
```

### Bitmask flags: pack booleans

Instead of multiple boolean properties (each is a hidden class slot), pack them into a single `_flags: number`:

```ts
const P_STARTED    = 1;   // 1 << 0
const P_COMPLETED  = 2;   // 1 << 1
const P_AUTO_DIRTY = 4;   // 1 << 2
const P_RESET      = 8;   // 1 << 3
const P_RESUB      = 16;  // 1 << 4
const P_PENDING    = 32;  // 1 << 5

// Read: this._flags & P_STARTED
// Set:  this._flags |= P_STARTED
// Clear: this._flags &= ~P_STARTED
```

### Method binding in constructor (not arrow functions)

Arrow function properties create a new function per instance. Binding in the constructor assigns to the instance once and avoids per-instance overhead in V8:

```ts
// Bad: arrow function — new Function object per instance
class Foo { emit = (v: T) => { ... }; }

// Good: prototype method + bind — shares prototype, one bound fn per instance
class Foo {
  constructor() { this.emit = this.emit.bind(this); }
  emit(v: T) { ... }
}
```

Binding is required for methods exposed as part of the public API (ProducerStore.emit, source, etc.) so they work when destructured.

### Snapshot-free completion: null before iterate

When completing/erroring, avoid allocating a snapshot array (`[...this._sinks]`). Instead, null the field before iterating the local reference:

```ts
const sinks = this._sinks;
this._sinks = null;   // null field first — any re-subscribe sees clean state
this._stop();         // cleanup before notifying
if (sinks) for (const sink of sinks) sink(END);
```

### Effect as closure, not class

`effect` is a terminal sink — it produces nothing, has no public API beyond `dispose()`, no subclassing. A pure closure is faster (V8 accesses closure variables faster than class properties, no hidden class overhead):

```ts
export function effect(deps, fn) {
  let dirtyDeps = 0;
  let disposed = false;
  let cleanup: (() => void) | undefined;
  // all state in closure-local variables
  return () => { /* dispose */ };
}
```

### Avoid Set for dirty tracking when ≤ 31 deps

`Set.has()` + `Set.add()` + `Set.delete()` have per-call overhead. A bitmask integer uses `|=`, `&=`, and `===` — single CPU instructions. Always prefer bitmask for derived/effect dirty tracking.

---

## 12. Inspector & Debugging

### What the inspector tracks now

The `Inspector` singleton holds all observability metadata outside of store objects (stores stay lean). It uses `WeakMap` keyed on the store instance so metadata is GC'd with the store.

```ts
Inspector.register(store, { name: "myStore", kind: "state" });
Inspector.getName(store);    // "myStore"
Inspector.getKind(store);    // "state"
Inspector.inspect(store);    // { name, kind, value }
Inspector.graph();           // Map<name, StoreInfo> of all live stores
Inspector.trace(store, cb);  // subscribe to value changes for debugging
```

All three store-producing primitives (producer, operator, derived) call `Inspector.register()` in their constructor. `state` inherits registration via `ProducerImpl`. Extras that create inner producers/operators pass `_skipInspect: true` to avoid double-registration.

### Enabling/disabling

- **Auto:** enabled in development (`process.env.NODE_ENV !== "production"`), disabled in production
- **Manual:** `Inspector.enabled = true/false`
- **Cost when disabled:** `register()` and `getName()` are no-ops. `getKind()` always reads (used by graph() which is dev-only anyway).

### Naming stores for debugging

Pass `name` in options to any core primitive:

```ts
const count = state(0, { name: "count" });
const doubled = derived([count], () => count.get() * 2, { name: "doubled" });
```

### `Inspector.trace()` for value change debugging

`trace()` subscribes to a store's callbag source and reports value changes. Useful for tracing which stores are actually updating in a chain. Note: `trace()` only sees DATA (type 1), not DIRTY/RESOLVED signals.

### Proposed: signal flow tracing (not yet implemented)

To support the "See through it" promise — making the graph fully observable without guessing — the inspector should be extended with:

**1. Event log** — a circular buffer of recent events across all registered stores:

```ts
Inspector.events: Array<{
  ts: number;          // performance.now() timestamp
  store: string;       // name or "store_N"
  kind: string;        // "producer" | "derived" | "operator"
  type: "DIRTY" | "RESOLVED" | "DATA" | "END" | "ERROR";
  value?: unknown;     // for DATA events only
}>
Inspector.startRecording(maxEvents?: number): void;
Inspector.stopRecording(): void;
Inspector.dumpEvents(): string;   // formatted table for copy-paste into bug reports
```

**2. Dependency edges** — register which stores depend on which, enabling graph visualization:

```ts
Inspector.registerEdge(parent: Store<unknown>, child: Store<unknown>): void;
Inspector.getEdges(): Map<string, string[]>;  // parent name → child names
// Used by derived/operator in _connectUpstream()
```

**3. Signal hooks** — low-level hooks called by the primitives on every signal, enabling custom devtools:

```ts
Inspector.onEmit?: (store: Store<unknown>, value: unknown) => void;
Inspector.onSignal?: (store: Store<unknown>, signal: Symbol) => void;
Inspector.onEnd?: (store: Store<unknown>, error: unknown) => void;
```

**4. `Inspector.dump()`** — structured snapshot for AI-assisted debugging:

```ts
Inspector.dump(): {
  graph: Record<string, { kind: string; value: unknown; deps: string[] }>;
  recentEvents: typeof Inspector.events;
}
// Paste Inspector.dump() into the chat to give the AI full graph context.
```

**Implementation notes:**
- All hooks check `Inspector.enabled` before doing anything — zero cost in production.
- `registerEdge()` is called in `operator._connectUpstream()` and `derived._connectUpstream()` when connecting to deps. `WeakMap<Store, WeakRef<Store>[]>` keeps edges GC-friendly.
- The event log is a fixed-size circular buffer (default 1000 events) allocated once at `startRecording()` — no per-event allocation.
- Hooks in primitives: `if (Inspector.onEmit) Inspector.onEmit(this, value)` — the `if` is branch-predicted away when hooks are null.

### AI-readable debug output (current)

`Inspector.graph()` returns a `Map<string, StoreInfo>` that is serializable. To dump the full reactive graph state:

```ts
const snapshot = Object.fromEntries(
  [...Inspector.graph()].map(([k, v]) => [k, { kind: v.kind, value: v.value }])
);
console.log(JSON.stringify(snapshot, null, 2));
```

For tracing signal flow through the graph, use `Inspector.trace()` on each store and log with timestamps. This gives a sequential timeline of which store changed when and with what value.

---

## 13. Summary: Decision Tree for New Extras

```
Need to implement a new extra?

1. Does it transform/filter values synchronously with static deps?
   YES → operator()
       → Forward ALL STATE signals downstream (no exceptions for unknown signals)
       → Single-dep: forward every DIRTY
       → Multi-dep: forward DIRTY only on first dirty dep (bitmask)
       → Suppress with RESOLVED (not silence) when rejecting DATA
       → Verify: DATA without prior DIRTY handled by bitmask rule (§5, §7)

2. Does it involve timers, promises, observables, or inner subscriptions?
   YES → producer() with autoDirty: true
       → Set initial: input.get() to avoid duplicate on first connect
       → Set equals: Object.is for dedup
       → Handle the sync inner completion race with innerEnded flag
       → return () => { /* clean up everything */ }

3. Does it fit neither? Is the pattern shared by multiple operators?
   YES → Add an option to producer() or operator() first
   NO  → Raw callbag as last resort (retry, concatMap inner detection)

For all extras:
  - Verify cleanup: trace every exit path, confirm all resources released
  - Verify error forwarding: upstream error → error(data), not complete()
  - Verify completion forwarding: upstream complete → complete()
  - Verify RESOLVED: every suppressed DATA must emit RESOLVED downstream
  - Verify reconnect: local state resets on reconnect (init re-runs for operator, fn re-runs for producer)
  - Match RxJS semantics exactly unless listed in §10 divergences table
```
