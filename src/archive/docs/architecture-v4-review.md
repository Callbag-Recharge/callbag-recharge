# Architecture v4 — Review & Refinement Notes

> **Status:** Review of `architecture-v4.md` against actual implementation and `state-management.md` goals.
> Conducted March 2026. Covers spec-reality alignment, cuts, redesigns, and additions.

---

## Part 1: Cut or Redesign

### 1.1 ADOPT Protocol (§6) — Remove protocol, keep output slot description

**What the spec says:** REQUEST_ADOPT/GRANT_ADOPT handshake with routeStack-based signaling for topology handoff when external subscribers arrive at a derived node's output slot.

**Why it's unnecessary:** The spec designed ADOPT for a model where derived nodes hold an "internal terminator" in the output slot, requiring a handoff when external subscribers arrive. The actual implementation sidesteps this entirely:

- STANDALONE derived: `_output = null`, dep connections always active via closures from `_connectUpstream()`. No terminator sits in the slot.
- Subscriber arrives: `_output = sink`, clear `D_STANDALONE`. Dep connections unchanged — they're independent of the output slot.
- Subscriber leaves: `_output = null`, set `D_STANDALONE`. Deps stay connected.

The output slot is purely a dispatch point. Dep connections and downstream dispatch are independent concerns. No handoff, no protocol.

**Verified scenario:** `A → B(derived) → C → D(effect)`, then E subscribes to B. B's output slot transitions from SINGLE (C) to MULTI (Set{C, E}). Mechanical — no upstream awareness, no signaling.

**ADOPT would only matter** in a lazy-derived model where derived disconnects from deps when idle and an internal terminator keeps the connection alive. That model was not built. Eager connection (deps always active) makes ADOPT unnecessary.

**Action:**
- Remove §6's ADOPT protocol description (REQUEST_ADOPT/GRANT_ADOPT flow, routeStack, three topology scenarios table)
- Keep and expand the output slot mode transitions (STANDALONE → SINGLE → MULTI → STANDALONE) as the replacement — this is what actually happens
- Keep `REQUEST_ADOPT`/`GRANT_ADOPT` symbols exported from `protocol.ts` for forward-compat, but mark as reserved/unused in the doc
- Add a "Why ADOPT isn't needed" note explaining that eager dep connection makes the output slot purely a dispatch point with no handoff semantics

### 1.2 Chain Model (§5) — Reframe as conceptual model, not literal composition

**What the spec says:** Every transform node assembles `_chain`: a composed callbag source function `dep.source → stateIntercept → map(fn) → valueIntercept → output slot`.

**What the code does:** The same stages exist but are inlined into the dep subscription handler closures. `_connectSingleDep()` and `_connectMultiDep()` contain the state tracking, transform, value caching, and dispatch as inline logic in one closure — not composed as separate callbag functions.

**The conceptual model is accurate.** The signal flow IS `dep.source → state tracking → transform → value caching → output dispatch`. The critical property — "whoever drives the pipeline, the tap fires" — holds because the handler closure captures `this` and always writes to `_cachedValue`/`_status`, regardless of whether `_output` has a downstream consumer. `_dispatch()` no-ops when `_output === null` (STANDALONE), but the state/value updates still happen.

**Action:**
- Reframe §5 as a conceptual model / mental model, not a literal implementation spec
- Make explicit that stages are inlined for zero-allocation performance
- Keep the signal flow diagrams — they accurately describe what happens
- Remove references to `_chain` as a concrete property on the class (it doesn't exist)
- Remove `B.sources` array concept (not implemented)

### 1.3 Plugin Composition Model (§16) — Remove

**What the spec says:** Nodes assembled from discrete plugins: StorePlugin, FanInPlugin, ControlPlugin, SourcePlugin, AdoptPlugin.

**Reality:** No plugin infrastructure exists. Capabilities are monolithic within class definitions. `ProducerImpl`, `DerivedImpl`, `OperatorImpl` each contain their full behavior inline. Effect is a pure closure.

**Why monolithic is better here:** Plugin composition adds indirection with no current benefit. The node types have fixed, well-defined responsibilities. Monolithic classes are simpler, faster (no dispatch overhead), and have stable V8 hidden classes.

**Action:**
- Remove §16 entirely
- The "init() timing split" subsection (construction time vs. connection time) is useful — relocate it to §10 (Lifecycle)

### 1.4 Raw Callbag Sink Wrapper (§16) — Redesign as interop multicast wrapper

**What the spec said:** Raw callbag sinks need wrapping to participate in the ADOPT protocol.

**Actual need:** ADOPT is gone, but there IS a real interop gap. A raw callbag operator is a plain `(type, data) => void` function — it has no `source()`, no `_output`, no output slot. It's 1-to-1: one upstream, one downstream.

**The problem:** Given `A → B → C` and `A → rawOp → C`, if E wants to subscribe to `rawOp`'s output, it can't. `rawOp` has no `source()` method, no multicast capability. E would need to create a duplicate subscription to A through a second rawOp instance — duplicating the upstream path with no shared state.

**Secondary concern:** Raw callbag operators in diamond topologies swallow STATE signals (DIRTY/RESOLVED), causing downstream nodes to fall back to the "DATA without prior DIRTY" compat path. This is correct but may cause double-computation at convergence points.

**Action:**
- Rewrite as "Raw Callbag Interop" section
- Frame the wrapper as: promoting a raw callbag operator to a proper node with `source()` + output slot for multicast capability
- Document the diamond behavior: raw operators that swallow STATE cause compat-path fallback (correct but potentially wasteful)
- Note that raw callbag sinks (terminal) need no wrapping — they just ignore STATE signals harmlessly

---

## Part 2: What Should Be Added or Redesigned

### 2.1 Push-Phase Memoization Cascade — Resolved (document as differentiator)

The full memoization cascade is implemented. It's one of our strongest competitive differentiators — no other state management library has this. Document it prominently.

#### The cascade

Each layer can short-circuit the entire downstream subtree:

```
Layer 1: Producer equals guard
  state({ id: 1 }, { equals: (a, b) => a.id === b.id })
  → set({ id: 1, label: "changed" })
  → equals returns true → NO emit, NO DIRTY sent → entire subtree untouched

Layer 2: Derived equals guard (push-phase memoization)
  derived([a], () => clamp(a.get()), { equals: (x, y) => x === y })
  → a changes from 3 to 4, clamp still returns 1
  → derived recomputes fn(), but equals matches → sends RESOLVED instead of DATA
  → downstream sees RESOLVED, not DATA → subtree skipped

Layer 3: Multi-dep all-RESOLVED skip (derived)
  derived([b, c], fn) where b and c both send RESOLVED
  → D_ANY_DATA flag stays false
  → dirtyDeps reaches 0 → all-RESOLVED path → skip fn() entirely, forward RESOLVED
  → fn() never called — zero computation cost

Layer 4: Effect all-RESOLVED skip
  effect([d], fn) where d sends RESOLVED
  → anyDataReceived stays false
  → dirtyDeps reaches 0 → skip run() → effect fn() not called
```

#### Why this matters

In a large graph, a state change at the root can be stopped at any layer. If a derived node's `equals` guard fires, every node below it — derived, operator, effect — skips entirely. No recomputation, no side-effects. The savings compound at each layer.

**No competitor has this.** Jotai recomputes on every dep change. Zustand has no derived graph. MobX has computed memoization but no multi-dep RESOLVED cascade. Nanostores recomputes computed on every change.

#### Test coverage needed

Verify the full 4-layer cascade with a dedicated test:
```
A(state) → B(derived, equals: clamp to 0/1) → D(derived [B, C])
A(state) → C(derived, equals: clamp to 0/1) → D         → E(effect)
```
Set A from 1 to 2 (both B and C stay clamped to 0). D should skip `fn()`, E should skip `run()`. Count calls to D's fn and E's fn to verify zero extra computation.

**Action:** Add a "Push-Phase Memoization" section to the architecture doc describing the 4-layer cascade. This is a first-class feature, not an optimization footnote.

### 2.2 Error Propagation & Completion — Resolved Design

**Design decision: one dep ends → entire multi-dep node ends.** This is correct and final. Rationale:

#### Two-tier lifetime model

The primitives split into two tiers by lifetime:

| Primitive | Lifetime | Public completion API? | Role |
|-----------|----------|----------------------|------|
| `state` | Immortal | No — `WritableStore<T>` has no `complete()`/`error()` | Always-alive value cell |
| `derived` | Tied to deps | No — only terminates reactively when a dep sends END | Always-alive computed |
| `producer` | Stream-aware | Yes — `ProducerStore<T>` exposes `complete()`/`error()` | Things that end |
| `operator` | Stream-aware | Yes — `Actions<T>` in handler has `complete()`/`error()` | Transforms that end |
| `effect` | Tied to deps | No — disposes on upstream END or manual `dispose()` | Side-effect runner |

**The core state graph (state + derived) is immortal by design.** State never completes publicly. Derived stays connected to deps (STANDALONE). This matches TC39 Signals where Signal.State/Signal.Computed have no lifecycle concept.

**Streams live in producer/operator.** These model things that end: HTTP responses, WebSocket connections, audio streams, timers. Completion/error semantics apply.

#### Error scoping via `rescue` (= try/catch)

`rescue` is the error boundary, and its **placement** determines the recovery scope — exactly like `try/catch` in synchronous code:

```ts
// 1. Protect one dep (catch at the dep level)
const safeDep = pipe(riskyProducer, rescue(err => fallback(err)))
const d = derived([safeDep, stableDep], fn)  // survives riskyProducer errors

// 2. Protect the whole computation (catch at the output level)
const safeD = pipe(
  derived([riskyDep, otherDep], fn),
  rescue(err => fallbackStore)
)

// 3. Retry a flaky source before it reaches the graph
const reliable = pipe(flakyProducer, retry(3), rescue(err => defaultValue))
const d = derived([reliable, config], fn)  // only fails after 3 retries + rescue exhausted
```

#### Why partial-dep-survival is wrong

If `derived([A, B], fn)` continued after A errors, it would need to:
1. Decide what value A has (undefined? last value? sentinel?)
2. Keep calling `fn()` with a zombie dep that will never update again
3. Confuse downstream nodes about whether the graph is healthy

This is the same reason `try { a(); b(); }` doesn't continue to `b()` after `a()` throws. The computation unit is atomic. If you want isolation, put the `try` (rescue) around the individual dep.

#### Diamond error propagation

`A → B, A → C, B+C → D` where A errors:
1. A sends `END(error)` to B and C
2. B receives END → B calls `_handleEnd(error)` → B sends `END(error)` downstream to D (dep 1)
3. C receives END → C calls `_handleEnd(error)` → C sends `END(error)` downstream to D (dep 0)
4. D receives first END → `D_COMPLETED` set, disconnects all upstream, notifies sinks
5. D receives second END → `D_COMPLETED` guard returns early. No double-notification.

**Correct.** D terminates exactly once. Order doesn't matter.

**Asymmetric rescue in diamonds:** `A → pipe(B, rescue(fb)) → D, A → C → D`. B catches A's error and continues via fallback. C gets A's raw error and terminates. D terminates because C (unprotected dep) sent END. If you want D to survive, rescue C too. The user controls the error boundary placement.

#### Keeping streams alive in the state graph

If a producer that may complete feeds into the always-alive state graph, wrap it:

```ts
// Option 1: rescue with fallback value
const safe = pipe(audioStream, rescue(() => state(silence)))

// Option 2: retry on error
const safe = pipe(wsConnection, retry(Infinity))

// Option 3: custom stay-alive producer
const safe = producer(({ emit, error }) => {
  // reconnect logic, emit values, never call complete()
})

// Then use in the immortal graph
const d = derived([safe, config], fn)  // safe never terminates → d never terminates
```

**No new `catch` operator needed.** `rescue` already IS catch — it takes an error and returns a recovery source. The name avoids JS reserved word collision (`catch` can't be a bare import). `retry` handles the "try again" case. Together they cover all error recovery patterns.

**Action:** Add an "Error Propagation & Completion" section to the architecture doc documenting:
- Two-tier lifetime model (immortal state graph vs. stream-aware producers)
- One dep ends → entire multi-dep node ends (atomic computation unit)
- `rescue` = try/catch, placement = scope
- Diamond error propagation (idempotent via `D_COMPLETED` guard)
- Patterns for keeping streams alive in the state graph

### 2.3 `getLive()` — Synchronous Pull-Through

**Current state:** `get()` returns `_cachedValue` which may be stale when `_status === DIRTY`. The doc punts on `getLive()` (deferred post-v4.0).

**Why it matters for positioning:** The `state-management.md` strategy positions against Jotai's implicit tracking by claiming "explicit deps, arguably better for debugging." A `getLive()` that forces synchronous upstream resolution completes this story — it's the explicit-deps answer to "I need the real-time value right now."

**Design sketch:**
- `getLive()` walks deps, calls each dep's `getLive()` recursively, then runs `_fn()` with fresh values
- Read-only: does NOT write to `_cachedValue` (same as current DISCONNECTED pull recompute)
- Only useful when `_status === DIRTY` — otherwise equivalent to `get()`
- Bounded by the graph depth — no infinite recursion possible in a DAG

**Action:** Add to open questions or design as a concrete proposal. Low priority but architecturally clean.

### 2.4 Completion Semantics for Multi-Dep Nodes — Resolved

**Resolved:** One dep ends → entire multi-dep node ends. This is correct. See §2.2 for full rationale.

The key insight: `state` and `derived` form the immortal state graph — they don't have public completion APIs. If a user feeds a stream (producer) that may complete into a derived, they should wrap it with `rescue`/`retry`/`repeat` or a custom stay-alive producer. The completion problem is solved at the boundary between stream-aware and always-alive nodes, not by making derived partial-completion-aware.

### 2.5 Streaming Topology Examples — Resolved

Add a section to the architecture doc showing how the two-tier model maps to real applications. These examples demonstrate the boundary between the immortal state graph and stream-aware producers.

#### 1. AI chat with cancellation

```
userInput(state) ─→ debounce ─→ switchMap(fetchLLM) ─→ scan(accumulate)
                    tier 2        tier 2                  tier 1
                    (cycle        (cycle boundary,        (stateful
                    boundary)     auto-cancels prev)      accumulator)
                                                             │
                              chatMessages(derived) ←────────┘
                                     │
                              effect(renderUI)
```

**Tier boundary:** `debounce` and `switchMap` are tier 2 producers — each `emit()` starts a fresh DIRTY+DATA cycle. `scan` is tier 1 (operator) — participates in diamond resolution. `chatMessages` is derived — always-current, immortal.

**Cancellation:** When `userInput.set("new query")`, `switchMap` auto-cancels the in-flight fetch and starts a new one. No AbortController juggling — it's automatic.

**Error handling:** Wrap `switchMap` with `rescue` to handle network errors:
```ts
const stream = pipe(userInput, debounce(300),
  switchMap(q => fromAsyncIter(fetchLLM(q))),
  rescue(err => of("Error: " + err.message))  // fallback value
)
const messages = pipe(stream, scan((acc, chunk) => acc + chunk, ""))
```

#### 2. Diamond with memoization cascade

```
         config(state)
          /          \
    priceCalc          taxCalc
  (derived, equals)  (derived, equals)
          \          /
       total(derived) ──→ effect(updateUI)
```

**Diamond resolution:** `total` computes exactly once per `config` change. Bitmask waits for both paths.

**Memoization cascade:** If `config` changes but `priceCalc` and `taxCalc` both produce the same output (equals guard fires), both send RESOLVED. `total` sees all-RESOLVED → skips `fn()` entirely → forwards RESOLVED → `effect` skips `run()`. Zero wasted computation.

#### 3. Real-time dashboard with stream-to-state boundary

```
wsConnection(producer) ──→ rescue(reconnect) ──→ throttle(100ms)
    stream-aware              error boundary       tier 2
                                                      │
                              latestPrice(state) ←────┘
                                     │
              derived([latestPrice, portfolio], computePnL)
                                     │
                              effect(updateChart)
```

**Stream-to-state boundary:** `wsConnection` is a producer that may error/complete. `rescue` wraps it to stay alive (reconnect on error). `throttle` rate-limits. The result feeds into `latestPrice(state)` — the immortal state graph. Everything below `latestPrice` is glitch-free, always-alive.

**The pattern:** stream → error handling → rate limiting → state → derived graph. The boundary is where `rescue`/`retry` live.

#### 4. Agentic workflow with tool calls

```
agentMemory(state) ──────────────────────────┐
                                              │
userMessage(state) ─→ derived([memory, msg],  │
                        buildContext)          │
                           │                  │
                    switchMap(callLLM)         │
                      tier 2                  │
                           │                  │
                    scan(parseToolCalls)       │
                      tier 1                  │
                           │                  │
                    effect([toolCalls], () => {│
                      // execute tools        │
                      // update agentMemory ──┘  (feedback loop via state)
                    })
```

**Feedback loop:** `effect` writes tool results back into `agentMemory(state)`, which feeds back into the context `derived`. This is safe because `state.set()` starts a new DIRTY+DATA cycle — no circular dependency. The graph is a DAG at any point in time; the feedback loop is temporal, not structural.

### 2.6 "What We Decided NOT to Build" — Resolved

Add this as a section to the architecture doc. Prevents future re-proposals.

#### ADOPT protocol (REQUEST_ADOPT / GRANT_ADOPT)

**Explored:** A type 3 handshake for topology handoff when external subscribers arrive at a derived node's output slot. The spec designed a routeStack-based signaling mechanism where REQUEST_ADOPT propagates downstream and GRANT_ADOPT routes back upstream.

**Why dropped:** The implementation uses eager dep connection for derived (STANDALONE mode). Dep connections are closures from `_connectUpstream()`, independent of the output slot. The output slot is purely a dispatch point — `null → fn → Set` transitions are mechanical with no upstream awareness. There is no internal terminator to hand off.

**When would it be needed:** Only if derived nodes used lazy dep connection (connect on first subscriber, disconnect on last). That model was rejected because derived stores must always have a current value via `get()`.

#### Literal chain composition

**Explored:** Each transform node assembles `_chain` — a composed callbag source function: `dep.source → stateIntercept → map(fn) → valueIntercept → output slot`. Nodes would expose a `sources[]` array of chain entries for downstream adoption.

**Why dropped:** The conceptual stages (state tracking → transform → value caching → dispatch) are real but inlined into dep subscription handler closures. Composing them as separate callbag functions would add allocation per signal and indirection per stage. The inline approach is zero-allocation — the closure captures `this` and writes in-place.

**The mental model still holds:** The signal flow IS `dep.source → state tracking → transform → value caching → output dispatch`. Just expressed as inline code, not composed functions.

#### Plugin system (StorePlugin, FanInPlugin, ControlPlugin, etc.)

**Explored:** Nodes assembled from discrete capability bundles. Each plugin contributes a subset of behavior; nodes use only what they need.

**Why dropped:** Monolithic classes (`ProducerImpl`, `DerivedImpl`, `OperatorImpl`) are simpler, faster (no dispatch overhead), and maintain stable V8 hidden classes. The node types have fixed responsibilities with no current need for runtime composition. Effect is a pure closure — even simpler.

**When would it be needed:** If new node types emerged that shared some but not all capabilities with existing ones. Currently, the three roles (source, transform, sink) cover all cases.

#### Lazy derived

**Explored:** Derived nodes only connect to deps when they have external subscribers. Disconnect on last subscriber leave.

**Why dropped:** Derived stores must always return a current value via `get()`. Lazy connection means `get()` would need to pull-recompute on demand (expensive, no caching benefit) or return stale values (misleading). Eager connection (STANDALONE) keeps `_cachedValue` always current with zero additional API complexity.

**Trade-off accepted:** Derived nodes hold dep references permanently (can't be GC'd while deps live). This is intentional — derived stores are assumed to be app-lifetime objects. Upstream END (completion/error) breaks the reference cycle via `_handleEnd()`.

#### Partial dep completion survival

**Explored:** When one dep in a multi-dep derived completes, should the derived continue with remaining deps?

**Why dropped:** The computation unit is atomic — like `try { a(); b(); }` in synchronous code. If dep A terminates, calling `fn()` with a zombie dep that will never update again produces meaningless results. Error recovery belongs at the dep boundary (`rescue`), not inside the multi-dep node. See §2.2 for full rationale.

#### Dedicated `catch` operator

**Explored:** A `catch` extra as an alias or alternative to `rescue` for familiarity with JS `try/catch` and `Promise.catch()`.

**Why dropped:** `catch` is a JS reserved word — can't be a bare import identifier. `rescue` already IS catch (takes error, returns recovery source). Adding `catchError` (RxJS name) would be a pure alias with no new capability. `rescue` + `retry` together cover all error recovery patterns.

### 2.7 Raw Callbag Interop Wrapper — Design

**Location:** `extra/wrap` (not `adapter/` — adapters are for external systems like Kafka/Redis; this is callbag ecosystem interop).

**The problem (recap):** A raw callbag operator is a plain `(type, data) => void` function — no `source()`, no `_output`, no multicast. It can't be subscribed to by multiple downstream nodes, and it swallows STATE signals (breaks diamond resolution).

**What the wrapper must do:**

1. **Output slot + multicast** — expose `source()` with the standard null → fn → Set output slot
2. **STATE signal forwarding** — intercept STATE from upstream, route around the raw op, re-dispatch downstream
3. **`get()` / value caching** — maintain `_value`, return last value

#### One function, two overloads

The three raw callbag kinds have different shapes and different wrapping needs:

| Kind | Raw shape | Wrapping | Tier |
|------|-----------|----------|------|
| Source | `(type: 0, sink) => void` | No input Store. Each DATA starts DIRTY+DATA cycle. | Tier 2 |
| Operator | `(source: Callbag) => Callbag` | Has input Store. STATE bypasses raw op. | Tier 1 |
| Sink | `(source: Callbag) => void` | **Not needed** — ignores STATE harmlessly | N/A |

Sinks don't need wrapping. Sources and operators are distinguished by whether an input Store is provided. **One `wrap` function with overloads:**

```ts
type Callbag = (type: number, payload?: any) => void

// Overload 1: wrap a raw callbag source → tier 2 store
function wrap<T>(rawSource: Callbag): Store<T>

// Overload 2: wrap a raw callbag operator with input → tier 1 store
function wrap<A, B>(input: Store<A>, rawOp: (source: Callbag) => Callbag): Store<B>

function wrap<T>(
  sourceOrInput: Callbag | Store<any>,
  rawOp?: (source: Callbag) => Callbag
): Store<T> {
  if (rawOp) return wrapOp(sourceOrInput as Store<any>, rawOp)
  return wrapSource(sourceOrInput as Callbag)
}
```

Detection: if two args → operator wrapping. If one arg → source wrapping. TypeScript overloads give correct types at the call site.

#### Source wrapping (tier 2)

No upstream store dep. Each DATA from the raw source starts a fresh DIRTY+DATA cycle via `autoDirty`:

```ts
function wrapSource<T>(rawSource: Callbag): Store<T> {
  return operator<T>(
    [],
    ({ emit, signal, complete, error }) => {
      let talkback: any
      rawSource(START, (type: number, data: any) => {
        if (type === START) talkback = data
        if (type === DATA)  { signal(DIRTY); emit(data) }
        if (type === END)   { data ? error(data) : complete() }
      })
      return () => { talkback?.(END) }
    },
    { kind: 'wrap' }
  )
}
```

#### Operator wrapping (tier 1, STATE bypass)

The key insight: the wrapper sits *around* the raw op, not inside it. STATE flows around the raw op (directly to the output slot), DATA flows through it (into the raw op, out as transformed values). One subscription to the input, split into two paths:

```
input.source ──→ wrapper intercept
                   ├── STATE ──→ signal(data) ──→ output slot  (tier 1)
                   └── DATA  ──→ rawOp ──→ emit(transformed)  (through raw op)
```

This makes the wrapped operator a **tier 1 participant** — STATE (DIRTY/RESOLVED) flows through it correctly for diamond resolution.

```ts
function wrapOp<A, B>(input: Store<A>, rawOp: (source: Callbag) => Callbag): Store<B> {
  return operator<B>(
    [],  // no typed deps — single manual subscription, split into STATE + DATA paths
    ({ emit, signal, complete, error }) => {
      // Create a synthetic callbag source that strips STATE before feeding rawOp.
      // The raw op sees clean type 0/1/2 callbag protocol.
      const stripped: Callbag = (type: number, payload: any) => {
        if (type !== START) return
        const sink = payload
        input.source(START, (t: number, d: any) => {
          if (t === START) sink(START, d)    // pass talkback through to raw op
          if (t === STATE) signal(d)         // intercept STATE → forward to our output
          if (t === DATA)  sink(DATA, d)     // let raw op see DATA
          if (t === END)   sink(END, d)      // let raw op see END
        })
      }

      // Apply the raw callbag operator to the stripped source
      const transformed = rawOp(stripped)
      let rawTalkback: any
      transformed(START, (type: number, data: any) => {
        if (type === START) rawTalkback = data
        if (type === DATA)  emit(data as B)
        if (type === END)   data ? error(data) : complete()
      })

      return () => { rawTalkback?.(END) }
    },
    { kind: 'wrap' }
  )
}
```

**Why operator wrapping works for diamonds:** Given `A → wrap(A, rawMap) → C` and `A → B → C`:

1. A sends DIRTY → `wrap`'s intercept catches STATE → `signal(DIRTY)` → C gets DIRTY from dep 0
2. A sends DIRTY → B forwards → C gets DIRTY from dep 1 → bitmask `0b11`
3. A sends DATA → `wrap`'s intercept lets DATA through to rawOp → rawOp transforms → `emit(result)` → C gets DATA from dep 0 → clears bit 0
4. A sends DATA → B computes → C gets DATA from dep 1 → clears bit 1 → `dirtyDeps === 0` → C recomputes once

Diamond resolved correctly. The wrapped operator is a full tier 1 participant.

**One subscription, two paths.** The intercept sits between `input.source` and the raw op. STATE goes to `signal()`, DATA goes to the raw op. No double-subscription. No wasted dispatch.

#### Constraint: tier 1 wrap is synchronous map-only

`wrap(input, rawOp)` assumes 1:1 synchronous DATA in → DATA out (map-like transforms). Two categories of raw callbag operators **must not** use `wrap`:

1. **Filtering operators** (e.g., `filter`, `take`, `skip`): Drop DATA without emitting — downstream bitmasks get stuck because DIRTY was forwarded but no DATA or RESOLVED follows.

2. **Tier 2 operators** (async/timer/dynamic subscription — e.g., `debounce`, `throttle`, `delay`, `flatMap`): Decouple the input-output timing. DATA out is not synchronous with DATA in, so STATE bypass (which forwarded DIRTY immediately) creates a DIRTY→value timing mismatch that breaks diamond resolution.

**Rule:** Only synchronous, 1:1 map-like raw callbag operators can use `wrap(input, rawOp)`. For filtering or tier 2 raw operators, use `operator()` directly with explicit signal handling (RESOLVED for filters, `signal(DIRTY); emit()` cycles for tier 2).

**Implemented** in `extra/wrap.ts` (~150 lines). Source wrapping uses `producer()` (tier 2, autoDirty). Operator wrapping uses `operator([input], handler)` with a pushable bridge callbag — STATE bypasses the raw op via `signal()`, DATA flows through the bridge. `computeInitial()` runs `input.get()` through the raw op synchronously for initial value + disconnected `getter()`.

### 2.8 §17 Open Questions — Update

**§17.1 (Initial value on first connection):** Resolved. STANDALONE mode ensures `_cachedValue` is populated at construction. **Mark resolved.**

**Remaining open questions:**
- `getLive()` synchronous pull-through design (§2.3) — P3, future

---

## Summary

### Resolved — ready to apply to architecture doc

| Item | Resolution |
|------|-----------|
| §6 ADOPT protocol | Remove. Output slot transitions are mechanical. Eager dep connection makes handoff unnecessary. |
| §5 Chain model | Reframe as conceptual model. Stages are real, implementation is inlined. |
| §16 Plugin composition | Remove. Monolithic classes are simpler and faster. Relocate init timing to §10. |
| §16 Raw callbag wrapper | **Implemented** as `extra/wrap` — one function, two overloads. Source=tier 2 (producer), operator=tier 1 (STATE bypass via pushable bridge). |
| Error & completion | Two-tier lifetime: state+derived immortal, producer+operator stream-aware. `rescue` = try/catch. |
| Push-phase memoization | 4-layer cascade fully implemented. Document as first-class differentiator. |
| Completion semantics | One dep ends → node ends. Atomic computation. Solved at stream-to-state boundary. |
| Streaming topologies | 4 examples: AI chat, diamond memoization, real-time dashboard, agentic workflow. |
| "Not built" section | 6 items documented with rationale: ADOPT, chains, plugins, lazy derived, partial completion, catch op. |
| §17.1 initial value | Resolved by STANDALONE mode. |

### Open

| Item | Status | Priority |
|------|--------|----------|
| `getLive()` synchronous pull-through | Design sketch in §2.3 | P3 — future |
