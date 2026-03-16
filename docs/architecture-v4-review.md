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

### 2.1 Push-Phase Memoization for Multi-Dep Nodes — Incomplete

**Current state:** Derived with `equals` sends RESOLVED instead of DATA when output unchanged (`derived.ts:95-99`). Effect correctly skips `fn()` when all deps RESOLVED and `anyDataReceived === false` (`effect.ts:62-64`).

**Gap:** Multi-dep derived nodes that receive ALL RESOLVED from deps still call `_recompute()` → `_fn()`. The `D_ANY_DATA` flag tracks whether any dep sent DATA, and the multi-dep path at `derived.ts:181-188` does skip `_fn()` when `!D_ANY_DATA`:

```ts
if (this._flags & D_ANY_DATA) {
    this._recompute();
} else {
    // All deps resolved without value change — skip fn()
    this._status = "RESOLVED";
    this._dispatch(STATE, RESOLVED);
}
```

**Correction:** This IS implemented for multi-dep derived. The all-RESOLVED skip path exists. Verify with tests that cover: `A(state) → B(derived, equals) → C(derived, equals) → D(derived [B, C])` where A changes but B and C both resolve unchanged — D should skip `fn()` and forward RESOLVED.

**Action:** Add a section documenting the full memoization cascade: producer `equals` → derived `equals` → RESOLVED propagation → downstream skip. This is a key differentiator vs competitors.

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

### 2.5 Streaming Topology Examples — Missing

**The `state-management.md` vision** sells streaming hard (AI chat, agentic workflows, real-time data). The architecture doc has no streaming topology examples.

**Action:** Add a section showing 2-3 streaming topologies mapped to the architecture:

1. **AI chat with cancellation:**
   ```
   userInput(state) → debounce → switchMap(fetchLLM) → scan(accumulate) → chatMessages(derived)
                                                                            ↓
                                                                        effect(renderUI)
   ```
   - `userInput`: state node
   - `debounce`: tier 2 producer (cycle boundary)
   - `switchMap`: tier 2 producer (auto-cancels previous fetch)
   - `scan`: tier 1 operator (accumulates chunks)
   - `chatMessages`: derived (always-current view)
   - `effect`: runs UI update

2. **Diamond with shared config:**
   ```
        config(state)
         /         \
   transform₁    transform₂
         \         /
        combined(derived) → effect
   ```
   - Diamond resolution ensures `combined` computes once per config change

3. **Real-time dashboard:**
   ```
   wsSource(producer) → throttle → state(latestPrice)
                                        ↓
                                   derived([latestPrice, portfolio], computePnL)
                                        ↓
                                   effect(updateChart)
   ```

### 2.6 "What We Decided NOT to Build" — Missing

**Action:** Add a section explicitly noting explored-and-dropped designs:
- ADOPT protocol: explored for topology handoff, unnecessary with eager dep connection
- Chain composition as literal callbag function composition: explored, inlined for performance
- Plugin system: explored for node assembly, monolithic classes are simpler and faster
- Lazy derived: explored, rejected in favor of eager connection (STANDALONE always-current)

This prevents future contributors from re-proposing these designs without understanding the context.

### 2.7 §17 Open Questions — Update

**§17.1 (Initial value on first connection):** Resolved. STANDALONE mode ensures `_cachedValue` is populated at construction. When C subscribes, C gets a talkback that can pull `_cachedValue` via `talkback(DATA)`. No re-trigger needed. **Mark resolved.**

**New open questions to add:**
- `getLive()` synchronous pull-through design (§2.3 above)
- Should multi-dep derived survive partial dep completion? (§2.4 above)
- Should the raw callbag interop wrapper be a core utility or an extra? (§1.4 above)

---

## Summary

| Section | Action | Priority |
|---------|--------|----------|
| §6 ADOPT protocol | Remove protocol, expand output slot transitions | P0 — spec-reality drift |
| §5 Chain model | Reframe as conceptual model | P1 — accurate but misleading |
| §16 Plugin composition | Remove entirely, relocate init timing to §10 | P1 — speculative |
| §16 Raw callbag wrapper | Redesign as interop multicast section | P2 — real but niche |
| Error & completion | Add section — two-tier lifetime model, rescue=try/catch | P1 — resolved design |
| Push-phase memoization | Document the cascade (already implemented) | P1 — differentiator |
| Streaming topologies | Add examples | P2 — supports state-management.md vision |
| "Not built" section | Add | P2 — prevents re-proposals |
| §17 open questions | Update (resolve 17.1, add new) | P1 — stale |
| `getLive()` | Add to open questions | P3 — future |
