# Architecture v4 — Draft

> **Status:** Design draft — core decisions resolved. The output slot model, ADOPT protocol,
> plugin composition, and status model are all settled. One open question remains (§17.1).
> This supersedes v3 once implementation begins. Do not implement without reviewing §17.1.

---

## 1. Core Principles

1. **Every node has a store.** Sources, transforms, and sinks all maintain `_value` and `_status`. This is the foundation of inspectability and ETL — any node in the graph can be read at any time via `.get()`.

2. **Three roles, not three primitives.** The fundamental callbag roles are source, transform, sink. Every node is one of these. `state` and `derived` are user-facing sugar; `producer`, `operator`, and `effect` are the implementation primitives.

3. **The chain is the unit of composition.** Each transform node internally assembles a composed callbag source function (`_chain`) that wires its deps through its transform and a tap that keeps its own store current. Downstream nodes subscribe to this chain, not to the node directly.

4. **A tap keeps every node's store current.** Even when a downstream node is driving the pipeline, the originating node's tap fires on every DATA and STATE signal passing through. The node's `_value` and `_status` are always up to date — no separate upstream subscription needed just for self-observation.

5. **Type 1 DATA carries only real values.** Never sentinels. DIRTY, RESOLVED, and other control signals live exclusively on type 3 STATE.

6. **Type 3 STATE is forwarded, not swallowed.** Unknown signals pass through downstream unchanged. This ensures forward-compatibility (PAUSE, RESUME, etc.).

7. **DIRTY before DATA, always.** Phase 1: DIRTY propagates downstream. Phase 2: DATA follows. `autoDirty: true` handles this automatically for producers.

8. **RESOLVED means "I was dirty, value didn't change."** Only sent if a DIRTY was sent in the same cycle. Never sent to suppress a value that was never promised.

9. **Bitmask at convergence points only.** Dirty-dep counting (bitmask) is only needed at nodes with multiple deps (diamonds). Linear single-dep chains carry DIRTY straight through — no counting needed.

10. **Batch defers DATA, not DIRTY.** DIRTY propagates immediately during `batch()`. DATA is deferred to the outermost batch exit. Diamond resolution works in batches because the full dirty state is established before any values flow.

11. **Completion is terminal.** After a node completes or errors, it emits nothing further. `resubscribable` is the only exception.

12. **Effects run inline.** When all dirty deps resolve, the effect fn runs synchronously. No scheduler.

13. **Compatibility targets: TC39 Signals, raw callbag, RxJS.** Same as v3.

---

## 2. Folder & Dependency Hierarchy

Structure is unchanged from v3. The implementation of `derived` and `operator` will converge but remain in separate files during transition.

```
src/
├── core/
│   ├── protocol.ts  ← type constants, batch, deferStart — no other core imports
│   ├── types.ts     ← Store, WritableStore, Actions, NodeStatus — no runtime imports
│   ├── inspector.ts ← observability singleton — imports protocol only
│   ├── producer.ts  ← source role — imports protocol + inspector + types
│   ├── state.ts     ← syntax sugar over producer
│   ├── operator.ts  ← transform role — imports protocol + inspector + types
│   ├── derived.ts   ← syntax sugar over operator with terminator management
│   ├── effect.ts    ← sink role — imports protocol + types
│   └── pipe.ts      ← map/filter/scan sugar via derived
├── extra/           ← operators, sources, sinks — import from core only
└── index.ts         ← public API barrel
```

**Strict rules** (unchanged):
- `core/` never imports from `extra/`
- `extra/` imports from `core/` only, never from each other
- `protocol.ts` and `types.ts` have zero runtime dependencies on other core files

---

## 3. Protocol: Type Constants & Signal Vocabulary

```ts
const START = 0;   // Callbag handshake
const DATA  = 1;   // Real values only — never sentinels
const END   = 2;   // Completion (no payload) or error (payload = error)
const STATE = 3;   // Control signals: DIRTY, RESOLVED. Future: PAUSE, RESUME.

const DIRTY    = Symbol("DIRTY");     // "My value is about to change."
const RESOLVED = Symbol("RESOLVED"); // "I was dirty, value didn't change."
```

**Direction — the graph is a DAG:**
```
sources → transforms → sinks   (DOWNSTREAM: DATA, DIRTY, RESOLVED, END)
sources ← transforms ← sinks   (UPSTREAM: talkback(END) = unsubscribe only)
```

**Two-phase push:**
```
sink(STATE, DIRTY)    // phase 1: "prepare"
sink(DATA, value)     // phase 2: "new value"
sink(STATE, RESOLVED) // alternative phase 2: "no change"
```

**Node status — new in v4:**

Every node tracks its own `_status`:

| Status | Meaning | Trigger |
|--------|---------|---------|
| `DISCONNECTED` | No downstream driving the chain | No subscribers to `_chain` |
| `DIRTY` | DIRTY received, waiting for DATA | Incoming STATE DIRTY |
| `SETTLED` | DATA received, value computed and cached | Incoming DATA (after computation) |
| `RESOLVED` | Was dirty, value confirmed unchanged | Incoming STATE RESOLVED |
| `COMPLETED` | Terminal — complete() was called | END without payload |
| `ERRORED` | Terminal — error() was called | END with error payload |

These statuses are written by the **tap** inside `_chain` (see §5).

> **Note:** `resubscribable` is a producer **option flag**, not a status. It allows a COMPLETED or ERRORED node to accept new subscribers and re-run from its `_start()` function. The status becomes DISCONNECTED again when a new subscriber arrives.

---

## 4. Node Roles

Every node has one of three callbag roles. `state` and `derived` are syntax sugar — they compile down to producer and operator respectively.

### Source (`producer`) — originates values

- Has no deps
- Maintains `_value` and exposes `get()` / `source()`
- `state(initial)` = producer with `set()` / `update()` sugar and `equals: Object.is`
- Emits DIRTY then DATA on change; emits RESOLVED if `equals` guard fires

### Transform (`operator` / `derived`) — receives deps, produces output

- Has one or more deps
- Maintains `_value` (last computed output) and `_status`
- Internally assembles `_chain`: a composed callbag source that wires deps through the transform + tap
- Exposes `get()` and `source()` — is a full store, subscribable by anything downstream
- `derived([deps], fn)` = operator with automatic terminator management (see §6)

### Sink (`effect`) — terminal, no downstream

- Has deps, tracks DIRTY/RESOLVED, runs `fn()` when deps settle
- Has no `get()` or `source()` — not a store, not subscribable
- Always the end of a graph path
- Returns `dispose()` — the only way to disconnect
- Implemented as a pure closure (no class, no hidden class overhead)

---

## 5. The Chain Model

This is the central new concept in v4.

### What `_chain` is

Every transform node B (derived, operator) internally constructs a composed callbag source function:

```
B._chain = A.source
             → stateIntercept   // updates B._status (DIRTY / RESOLVED)
             → map(B.fn)        // applies B's transformation
             → valueIntercept   // writes computed value to B._value
```

`B._chain` is a single `(type, payload) => void` function — a standard callbag source. Subscribing to it drives the whole pipeline from A through B's transform and tap, producing B's computed values.

The two intercepts together form B's **tap**. They are transparent to the flow — they observe and record but do not alter what passes through.

### `stateIntercept`

Fires on STATE signals, updates `B._status`, then forwards the signal downstream unchanged:

```
STATE DIRTY    → B._status = DIRTY;    forward DIRTY downstream
STATE RESOLVED → B._status = RESOLVED; forward RESOLVED downstream
STATE unknown  → forward unchanged (required for forward-compat)
END            → B._status = DISCONNECTED; forward END downstream
```

### `valueIntercept`

Fires on DATA, writes to `B._value`, then forwards downstream:

```
DATA value → B._value = value; B._status = SETTLED; forward DATA downstream
```

### `B.sources`

`B.sources` is the array of chain entries B exposes for downstream adoption:

```ts
B.sources = [B._chain]  // single-dep B
```

For a multi-dep node C depending on [A, B]:
```ts
C.sources = [A.sources[0], B.sources[0]]
          = [A.source,     B._chain]
```

C assembles its own `_chain` by taking each entry from deps' `.sources`, potentially wrapping them with C's own stateIntercept, fan-in logic, map(C.fn), and valueIntercept.

### Why `_chain` contains the tap

The tap being *inside* `_chain` is the key insight. Whoever drives the pipeline (B's own terminator, or a downstream C, or a downstream effect) — B's tap fires regardless. B's `_value` and `_status` stay current as a side-effect of any subscription to `B._chain`.

---

## 6. Downstream Adoption & The Output Slot

Every transform node B has an **output slot** at the tail of `B._chain`. The output slot is the multicast dispatch point — it routes every DATA/STATE/END signal to whoever is currently subscribed to B. This replaces subscriber-count bookkeeping and avoids any involvement of upstream nodes in topology changes.

```
B._chain = A.sources[0]
             → stateIntercept
             → map(B.fn)
             → valueIntercept
             → [OUTPUT SLOT]   ← dispatch point; owned by SourcePlugin
```

A itself is always completely unaware of what happens at the output slot. It has exactly one subscriber: the tail of B._chain.

### Mode 0: STANDALONE

`derived` only (`operator` is lazy). When B has no external subscribers:

- B's own **internal terminator** is registered in the output slot
- B drives the pipeline: A → B._chain → output slot → terminator
- B._value and B._status are current via the tap
- `B.get()` returns `B._value` — always populated, never DISCONNECTED

> **Why derived auto-connects but operator doesn't:**
> `derived([A], fn)` is user-facing sugar meant to be "always reactive." The user expects
> `derived.get()` to return the current computed value. `operator` is a lower-level
> building block that only activates when subscribed to.

### Mode 1: SINGLE

When the first external subscriber C subscribes to B:

1. B releases the internal terminator from the output slot
2. C is registered in the output slot
3. A → B._chain continues uninterrupted; only the final dispatch target changes
4. B's tap fires as before — B._value and B._status remain current

C receives a talkback. Calling `talkback(END)` removes C from the output slot.

### Mode 2: MULTI

When a second subscriber D subscribes while C is already in the slot:

1. The output slot switches from single-dispatch to Set-based dispatch
2. Both C and D are in the Set
3. Emissions dispatch to all sinks in one pass
4. Additional subscribers just join the Set — no upstream restructuring
5. Each `talkback(END)` removes only that specific sink from the Set

**Key:** A never gets an additional subscriber. The only topology change is in the output slot. This is the decisive advantage: topology changes are O(1) and source-agnostic.

### REQUEST_ADOPT / GRANT_ADOPT protocol

When C depends on [A, B] (B also depends on A, diamond topology), C subscribing to B's output slot means B's internal terminator should be released. The ADOPT protocol handles this handoff cleanly.

**Type 3 signal extension** — control signals can carry structured data as `[Symbol, data?]` tuples:

```ts
const REQUEST_ADOPT = Symbol("REQUEST_ADOPT");
const GRANT_ADOPT   = Symbol("GRANT_ADOPT");

// Sent as: sink(STATE, [REQUEST_ADOPT, routeStack])
//           talkback(STATE, [GRANT_ADOPT, routeStack])
```

Unknown type 3 signals are always forwarded unchanged (principle §6), so this extension is backward-compatible.

**REQUEST_ADOPT flow (downstream):**

1. C subscribes to B and sends `(STATE, [REQUEST_ADOPT, []])` into B._chain
2. Each layer in B._chain that is a dep junction pushes its dep index onto `routeStack`
3. When REQUEST_ADOPT reaches B's output slot, the slot sends `(STATE, [GRANT_ADOPT, routeStack])` back upstream via the chain's talkback path
4. GRANT_ADOPT routes step-by-step through `routeStack` back to the originator
5. B releases its internal terminator; C is installed in the output slot

**Three topology scenarios:**

| Scenario | ADOPT behavior |
|----------|---------------|
| A→B, add C | C sends REQUEST_ADOPT; output slot installs C, releases terminator |
| A→B→C and A→C, C unsubscribes | C's `talkback(END)` removes C from both A's and B's output slots |
| A→B→C and A→C, add D | D sends REQUEST_ADOPT to B; output slot switches to Set{C, D} |

### DISCONNECTED

When the last external subscriber leaves:

- For `derived`: internal terminator re-registers in the output slot (back to STANDALONE)
- For `operator`: output slot is empty, `_status = DISCONNECTED`, pipeline pauses

B._value is retained — `get()` still returns the last SETTLED value.

---

## 7. `.get()` Semantics

`.get()` returns a meaningful value at all times. When `_status` is DIRTY, `.get()` also communicates staleness — it does not silently return a stale value as if it were fresh.

| Status | `.get()` behavior |
|--------|-------------------|
| `SETTLED` | Return `_value` — definitely current |
| `RESOLVED` | Return `_value` — guaranteed unchanged from last SETTLED |
| `DIRTY` | Return `_value` alongside a staleness indicator (exact API TBD — see below) |
| `DISCONNECTED` | Pull-based recompute: call each dep's `.get()`, apply `fn`, return result |
| `COMPLETED` / `ERRORED` | Return `_value` — last value before terminal; `_status` communicates terminal state |

**Honest DIRTY feedback** — when `_status === DIRTY`, a new value is in flight. Silently returning `_value` misleads callers. Options for the API shape:
- `inspect()` → `{ status, value }` for callers that need to distinguish fresh vs. stale
- `get()` returns `_value` as-is (compatible with existing usages); staleness queryable via `node._status`
- Future: `getLive()` forces a synchronous upstream pull to return the real-time value

The chosen approach is: `.get()` returns `_value` for compatibility; `_status` is always publicly readable; `Inspector.inspect()` surfaces both together. The full pull-propagation design for a `getLive()` is deferred post-v4.0.

**DISCONNECTED pull recompute** does NOT write to `_value`. It is a read-only on-demand computation. `_value` only reflects values that actually flowed through the connected pipeline.

---

## 8. Diamond Resolution

Diamond resolution works correctly in v4 via the same bitmask algorithm as v3, applied at convergence points (multi-dep nodes).

### Example: C depends on [A, B] where B depends on A

C's `_chain` is assembled from:
- `A.sources[0]` = A.source  (dep 0)
- `B.sources[0]` = B._chain = A.source → B.stateIntercept → B.map → B.valueIntercept  (dep 1)

C subscribes to both. A gets two sinks (C's direct + B's chain on behalf of C).

**Signal flow:**
1. A sends DIRTY → flows to C's dep-0 connection → C sets bit 0 → `dirtyDeps = 0b01` → C forwards DIRTY downstream (first dirty dep)
2. A sends DIRTY → flows through B._chain → B.stateIntercept fires (B._status = DIRTY) → arrives at C's dep-1 connection → C sets bit 1 → `dirtyDeps = 0b11` → idempotent (DIRTY already forwarded)
3. A sends DATA → flows through B._chain → B.map computes → B.valueIntercept fires (B._value updated, B._status = SETTLED) → DATA arrives at C's dep-1 → C clears bit 1 → `dirtyDeps = 0b01` → not 0, wait
4. A sends DATA → also arrives at C's dep-0 directly → C clears bit 0 → `dirtyDeps = 0` → recompute: `fn(A._value, B._value)` — both values are current

C computes exactly once. B._value is updated via its tap. Diamond resolution holds.

**Key:** The bitmask waits for both paths. The ordering (which DATA arrives first) doesn't matter. Correctness is guaranteed by waiting for all bits to clear.

### Bitmask algorithm (unchanged from v3, applied at multi-dep nodes only)

```ts
let dirtyDeps = 0;

// On STATE DIRTY from depIndex:
const bit = 1 << depIndex;
const wasClean = dirtyDeps === 0;
dirtyDeps |= bit;
if (wasClean) signal(DIRTY);           // forward on first dirty dep only

// On STATE RESOLVED from depIndex:
dirtyDeps &= ~(1 << depIndex);
if (dirtyDeps === 0) signal(RESOLVED); // all resolved without DATA

// On DATA from depIndex:
dirtyDeps &= ~(1 << depIndex);         // clear bit; no-op if not set (raw callbag)
if (dirtyDeps === 0) recompute();      // act only when all deps resolved
```

**Single-dep chains:** No bitmask. Forward every DIRTY directly.

---

## 9. Signal Handling Reference

### Direction (unchanged)

- **DIRTY, RESOLVED, DATA, END** → downstream
- **talkback(END)** → upstream (unsubscribe only)

### What each node does with each signal

| Signal | producer (source) | operator / derived (transform) | effect (sink) |
|--------|------------------|-------------------------------|---------------|
| STATE DIRTY received | N/A (source) | stateIntercept → update `_status = DIRTY`; single-dep: forward; multi-dep: bitmask → forward if first | Track in bitmask; do NOT forward |
| STATE RESOLVED received | N/A | stateIntercept → update `_status = RESOLVED`; single-dep: forward; multi-dep: bitmask → if 0, forward | Bitmask → if 0, skip fn() |
| STATE unknown received | N/A | **Forward downstream unchanged — no exceptions** | Ignore (terminal) |
| DATA received | N/A | valueIntercept → `_value = computed`; `_status = SETTLED`; single-dep: forward; multi-dep: bitmask → if 0, compute+forward | Bitmask → if 0, run fn() |
| END (completion) received | N/A | `_status = DISCONNECTED`; complete() → disconnect upstream, notify sinks | cleanup(); disconnect from all talkbacks |
| END (error) received | N/A | `_status = DISCONNECTED`; error(e) → disconnect upstream, notify sinks with error | cleanup(); disconnect from all talkbacks |
| DIRTY sent | `signal(DIRTY)` before `emit()` | `signal(DIRTY)` downstream (from bitmask or single-dep forward) | N/A |
| RESOLVED sent | `signal(RESOLVED)` when equals guard | `signal(RESOLVED)` when suppressing or all-RESOLVED bitmask | N/A |
| DATA sent | `emit(value)` | emit computed value downstream | N/A |

### Tier 2 extras (cycle boundaries)

Tier 2 nodes (debounce, switchMap, etc.) use `subscribe()` internally, which is a callbag sink that receives only DATA (type 1). Tier 2 nodes do not receive DIRTY/RESOLVED from upstream. Each `emit()` starts a fresh DIRTY+DATA cycle via `autoDirty: true`. Tier 2 always produces DATA — upstream nodes always get a tap event when tier 2 fires.

### DATA without prior DIRTY (raw callbag compat)

When a dep sends DATA without having sent DIRTY (raw callbag source with no type 3 support):

```ts
// Applied universally to operator, derived, effect:
if (type === DATA) {
  dirtyDeps &= ~(1 << depIndex); // clear bit if set; no-op if not (raw callbag case) (Comment: why clear bit if not set? I feel that we should always keep track of the input data for the dep even if it's not dirty so when bitmask is 0 we can recompute using this cache for that dep)
  if (dirtyDeps === 0) recompute(); // wait for all known-dirty deps
}
```

Values from raw callbag deps are captured by calling `dep.get()` inside `recompute()` — the dep's value is current even if no DIRTY was sent.

---

## 10. Lifecycle: Startup, Teardown, Cleanup, Reconnect

### Chain assembly (startup)

When a transform node B is created with deps `[A]`:

```
derived([A], fn) or operator([A], init):
  1. Assemble B._chain:
       A.sources[0]                    // get A's chain entry
       → stateIntercept(→ B._status)   // wrap with B's status tap
       → map(fn)                        // wrap with B's transform
       → valueIntercept(→ B._value)    // wrap with B's value tap

  2. If derived: subscribe B._chain with B's internal terminator (STANDALONE mode)
     If operator: wait for first external subscriber

  3. Register with Inspector: kind, name, initial value
```

Multi-dep chain assembly `[A, B]`:
```
  1. Take A.sources[0] and B.sources[0] as separate chain entries
  2. Create fan-in node: subscribes to both chains, applies bitmask logic
  3. Wrap fan-in with C's map(fn) and valueIntercept
  4. B._chain is the composed fan-in + transform + tap
```

### Connection batching

`beginDeferredStart()` / `endDeferredStart()` queues all chain activations. They fire together at `endDeferredStart()`, ensuring a subscriber's baseline is captured before any producer starts emitting. Unchanged from v3.

### Teardown (last subscriber leaves)

```
talkback(END) ← upstream from subscriber
  → B._subscriberCount--
  → if count === 0:
      if derived: re-activate internal terminator (back to STANDALONE)
      if operator: B._status = DISCONNECTED
      // B._value retained — get() can still return last SETTLED value
```

Note: B does NOT disconnect from A when going back to STANDALONE. The internal terminator re-subscribes to `B._chain`, which reconnects to A.

### Completion/error teardown

```
complete() or error(e):
  → if completed: return                          // idempotency guard
  → completed = true
  → B._status = DISCONNECTED
  → for each talkback: talkback(END)              // disconnect upstream
  → talkbacks = []
  → localSinks = _sinks; _sinks = null            // null before notifying
  → _stop()                                       // cleanup BEFORE notifying
  → for each sink: sink(END) or sink(END, e)      // notify downstream
```

**Cleanup before notification** (unchanged from v3): ensures `resubscribable` re-subscription finds a clean state.

### Reconnect

- **derived**: automatically re-activates internal terminator when all subscribers leave. Reconnect is transparent.
- **operator**: reconnects when a new subscriber calls `source(START, ...)`. `init()` re-runs, handler-local state resets.
- **producer**: `_start()` re-runs on new subscriber after last left. If `resetOnTeardown`, `_value` resets.
- **effect**: no reconnect. Dispose and create new.
- **Completed nodes**: reject new subscribers (immediate START + END) unless `resubscribable`.

---

## 11. Where to Put Guards, Stops, Passthroughs, Switches

### Guard placement (unchanged)

```ts
return (depIndex, type, data) => {
  if (completed) return;        // ALWAYS first
  if (type === STATE) { ... }
  if (type === DATA) { ... }
  if (type === END) { ... }
};
```

### Passthrough convention (unchanged)

```ts
if (type === STATE) signal(data);        // forward all STATE, no exceptions
if (type === DATA)  emit(transform(data));
if (type === END)   data ? error(data) : complete();
```

### RESOLVED when suppressing (unchanged)

Operators that reject DATA (filter, distinctUntilChanged) MUST send `signal(RESOLVED)`. Silence leaves downstream bitmasks in a permanently waiting state.

### Dynamic upstream = tier 2

Dynamic upstream (dep changes at runtime) is a tier 2 pattern — use producer + subscribe. Operator deps (and thus `_chain` structure) are static. Sync inner completion race guard (`innerEnded` flag) is required. See v3 §8.

---

## 12. Resource Allocation & Cleanup

Every tier 2 extra must clean up all resources it allocates. The chain model does not change this — tier 2 nodes are producers, not operators, and their cleanup happens in the producer's `_stop()`.

| Resource | Cleanup |
|----------|---------|
| `setInterval` | `clearInterval(id)` |
| `setTimeout` | `clearTimeout(id)` |
| `addEventListener` | `removeEventListener(event, handler)` |
| `subscribe()` return | `unsub()` |
| Inner callbag talkback | `talkback(END)` |
| Inner store subscription | `innerUnsub?.()` |
| Pending promise | `cancelled = true` flag |
| Observable subscription | `subscription.unsubscribe()` |

---

## 13. Operator Behavioral Compatibility

### Default: follow RxJS

For any operator with an RxJS equivalent, match RxJS semantics. See [rxjs.dev/api](https://rxjs.dev/api). Do not guess.

### Documented divergences from RxJS

| Behavior | RxJS | callbag-recharge v4 | Reason |
|----------|------|---------------------|--------|
| Value suppression | No emission | Must send `signal(RESOLVED)` | Downstream bitmasks need clearing |
| `filter` non-match | No emission | `signal(RESOLVED)` | Same |
| `distinctUntilChanged` equal | No emission | `signal(RESOLVED)` | Same |
| `share()` | Adds refcounting | No-op | Stores are inherently multicast |
| Completion ordering | Notify sinks first | Cleanup first | Reentrancy safety for `resubscribable` |
| `batch()` | No equivalent | Defers DATA, DIRTY immediate | Diamond resolution across batched changes |
| `effect` | No equivalent | Inline, synchronous | No global scheduler |
| `state` completion | N/A (TC39 infinite) | Inherits from producer | Deliberate; state is a callbag, not a pure TC39 Signal |

### TC39 Signals compatibility (unchanged)

`state` matches TC39 Signal.State: `equals: Object.is` default, `set(same)` is no-op, batch defers DATA.

### Raw callbag compatibility (unchanged)

Type 1 is pure values only. Raw callbag sources feed into the graph via the "DATA without prior DIRTY" rule (§9).

---

## 14. Optimization Guidelines

### V8 hidden class: classes for hot paths

`ProducerImpl`, `OperatorImpl` remain as classes. All instance properties initialized in constructor, consistent shape. `_chain` is a new property added at construction — must be declared in the class definition to maintain hidden class stability.

```ts
class OperatorImpl<T> {
  _value: T | undefined;
  _status: NodeStatus = "DISCONNECTED";
  _chain: Callbag;        // ← new in v4 — declared in constructor
  _sinks: Set<any> | null = null;
  _flags: number;
  // ...
}
```

### Bitmask flags (unchanged)

Pack booleans into `_flags: number`. Add `O_STANDALONE` and `O_SHARED` bits for the adoption mode tracking.

### Method binding in constructor (unchanged)

Bind public API methods in constructor, not as arrow functions.

### Tap intercepts: zero-allocation

The stateIntercept and valueIntercept wrappers should not allocate on every signal. Implement as closures capturing references to `_value` and `_status` on the node instance — write-in-place, no objects created.

### Snapshot-free completion (unchanged)

Null `_sinks` before iterating, no `[...this._sinks]` snapshot.

### Shared `_chain` construction

`_chain` is built once in the constructor. The composition (`A.sources[0]` → wraps → wraps) is eager — a closure chain, assembled once, reused for all subscribers. No re-construction on reconnect.

### Effect as closure (unchanged)

`effect` remains a pure closure. No class. All state in closure-local variables.

---

## 15. Inspector & Debugging

### Current capabilities (v3)

```ts
Inspector.register(store, { name, kind });
Inspector.getName(store);
Inspector.getKind(store);
Inspector.inspect(store);  // { name, kind, value }
Inspector.graph();         // Map<name, StoreInfo>
Inspector.trace(store, cb); // subscribe to value changes
```

### New in v4: status tracking

Every registered store exposes `_status`. Inspector should surface this:

```ts
Inspector.inspect(store): {
  name: string | undefined;
  kind: string;
  value: unknown;
  status: "DISCONNECTED" | "DIRTY" | "SETTLED" | "RESOLVED";  // ← new
}
```

### Proposed additions (from v3 architecture doc, still planned)

**1. Event log** — circular buffer of recent signal events:
```ts
Inspector.startRecording(maxEvents?: number): void;
Inspector.stopRecording(): void;
Inspector.events: Array<{ ts, store, kind, type, value? }>;
Inspector.dumpEvents(): string;
```

**2. Dependency edges** — registered by operator/derived during chain assembly:
```ts
Inspector.registerEdge(parent: Store, child: Store): void;
Inspector.getEdges(): Map<string, string[]>; // parent → children
```

**3. Signal hooks** — called by primitives on every emission:
```ts
Inspector.onEmit?: (store, value) => void;
Inspector.onSignal?: (store, signal) => void;
Inspector.onEnd?: (store, error) => void;
Inspector.onStatus?: (store, status) => void;  // ← new: fired when _status changes
```

**4. `Inspector.dump()`** — structured snapshot for AI-assisted debugging:
```ts
Inspector.dump(): {
  graph: Record<string, { kind, value, status, deps: string[] }>;
  recentEvents: typeof Inspector.events;
}
```

### Where taps register with Inspector

The `valueIntercept` in each `_chain` is the natural hook for `Inspector.onEmit` and `Inspector.onStatus`. It already fires on every value and every status change. Adding inspector calls here is zero-cost when hooks are null:

```ts
// Inside valueIntercept closure:
node._value = computedValue;
node._status = "SETTLED";
if (Inspector.onEmit) Inspector.onEmit(node, computedValue);
if (Inspector.onStatus) Inspector.onStatus(node, "SETTLED");
```

Similarly, `stateIntercept` hooks into `onSignal` and `onStatus`.

---

## 16. Plugin Composition Model

Nodes are assembled from **plugins** — discrete capability bundles. A node uses only the plugins it needs. This keeps hot-path nodes lean and avoids unused overhead.

| Plugin | Capabilities | Used by |
|--------|-------------|---------|
| `StorePlugin` | `_value`, `_status`, `get()` | All nodes |
| `FanInPlugin` | bitmask, `depValues[]`, multi-dep subscription management | Multi-dep nodes only (single-dep nodes skip this entirely) |
| `ControlPlugin` | STATE channel (DIRTY/RESOLVED forwarding), `onConnect()`/`onDisconnect()` lifecycle callbacks | All tier 1 nodes (derived, operator, effect) |
| `SourcePlugin` | `source(START, sink)`, output slot (single → Set transition), talkback management | All subscribable nodes (not effect) |
| `AdoptPlugin` | REQUEST_ADOPT/GRANT_ADOPT handling, output slot handoff | All subscribable nodes + effect |

### Why effect needs AdoptPlugin

`effect` is the terminal node and never has downstream subscribers, but it still needs `AdoptPlugin` to participate in the ADOPT protocol gracefully. When C (an effect) drives a graph through B, C needs to be installable into B's output slot and removable via `dispose()`. Without AdoptPlugin, C cannot send REQUEST_ADOPT and B cannot properly hand off. Every node that connects to the graph as a subscriber must be an ADOPT-aware participant.

> **Rule:** Any node that subscribes to another node's output slot needs `AdoptPlugin`. Only nodes that are provably permanent terminals with no topology changes may skip it — and there are none in the current design.

### Raw callbag sink wrapper

When a raw callbag sink (a plain `(type, data) => void` function, not a node) is connected to the graph, it must be wrapped so it can participate in the ADOPT protocol. The wrapper gives the raw sink full `ControlPlugin + AdoptPlugin` capabilities:

```ts
// Wrapping a raw sink:
function wrapRawSink(rawSink: Callbag): AdoptAwareNode {
  // ControlPlugin: forwards STATE signals to rawSink as DATA (tier 2 boundary)
  // AdoptPlugin:   handles REQUEST_ADOPT by responding with GRANT_ADOPT
  // rawSink itself receives only type 0, 1, 2 — protocol is preserved
}
```

Without this wrapper, a raw sink receiving a REQUEST_ADOPT signal would either silently drop it or mishandle it, breaking the ADOPT chain for the entire upstream graph.

### init() timing split

Node initialization is split into two phases to support clean reconnect semantics:

**Construction time** — runs once when the node is created:
- Assemble `_chain` (dep subscriptions, stateIntercept, map, valueIntercept, output slot)
- Wire plugins (FanIn, ControlPlugin, SourcePlugin, AdoptPlugin)
- Register with Inspector
- For `derived`: install internal terminator in output slot (STANDALONE)

**Connection time** — runs via `onConnect()` each time a subscriber arrives (or the terminator is installed):
- Allocate handler-local state: counters, accumulators, skip counts, flags
- This is the equivalent of `init()` running fresh in v3 operator

**Disconnection time** — runs via `onDisconnect()` when all subscribers leave:
- Release handler-local state
- For `operator`: no reconnect until next subscriber; state is gone

This split means `_chain` is always structurally stable (no re-wiring on reconnect), while behavioral state (counters, queues) resets cleanly on each new subscription session.

---

## 17. Open Questions (Remaining)

### 17.1 Initial value on first connection

When B transitions from STANDALONE to SINGLE (C subscribes), B's `_value` is already populated from its STANDALONE operation. C should receive B's current value as the starting point without re-triggering the A → B computation. This is likely handled by the `initial` option on the underlying producer, but needs explicit verification with the output slot + onConnect lifecycle design.

---

## 18. Summary: Decision Tree for New Extras

```
Need to implement a new extra?

1. Synchronous transform with static deps?
   YES → operator() (or derived() as sugar)
       → Assemble _chain from dep sources
       → stateIntercept and valueIntercept handle tap automatically
       → single-dep: forward every DIRTY
       → multi-dep: use FanInPlugin (bitmask + depValues)
       → Suppress with RESOLVED (not silence) when rejecting DATA
       → Forward unknown STATE signals always

2. Async, timer-based, or dynamic upstream?
   YES → producer() with autoDirty: true
       → Subscribe to input internally (subscribe() for DATA only)
       → Emit results as new DIRTY+DATA cycles
       → Set initial + equals to prevent spurious emissions
       → Return cleanup fn that releases all resources
       → innerEnded flag for sync inner completion race

3. Pattern shared by many operators?
   YES → Add option to producer() / operator() before duplicating boilerplate

4. Fused pipe chain?
   → pipeDerived() for always-reactive (auto-connects like derived)
   → pipeRaw() for lazy (DISCONNECTED like operator)
   → Both fuse N transforms into one _chain with one output slot
   → SKIP sentinel for filter semantics in both

5. None of the above?
   → Raw callbag as last resort

For all extras:
  - Verify cleanup: every exit path releases all resources
  - Verify error forwarding: upstream END with payload → error(), not complete()
  - Verify RESOLVED: every suppressed DATA must emit RESOLVED downstream
  - Verify reconnect: state resets (init re-runs for operator, fn re-runs for producer)
  - Match RxJS semantics unless in the divergences table (§13)
  - All nodes register with Inspector (kind, name); skip for inner anonymous nodes
```
