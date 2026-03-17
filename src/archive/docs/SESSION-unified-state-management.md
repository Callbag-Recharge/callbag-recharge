---
SESSION: unified-state-management
DATE: March 16, 2026
TOPIC: Unified State Management — Frontend, Backend, and the AI Memory Layer
---

## KEY DISCUSSION

### The false divide: frontend "state management" vs backend "infrastructure"

Frontend and backend solve the same fundamental problem — **coordinating reactive data flow** — but the ecosystems evolved separately and don't recognize each other.

**Frontend state management** (Zustand, Jotai, Redux, MobX, Nanostores, Signals):
- In-process, ephemeral (dies on refresh)
- Granularity: individual UI values, form fields, derived computations
- Reactivity model: subscribe → re-render
- Pain: glitches (diamond problem), no streaming, no cancellation, framework-locked

**Backend "state"** (Redis, Kafka, PostgreSQL, RabbitMQ):
- Out-of-process, durable (survives restarts)
- Granularity: documents, streams, queues, topics
- Reactivity model: pub/sub, polling, LISTEN/NOTIFY
- Pain: no derived computation, no diamond resolution, no in-process reactivity, manual coordination

### Why they feel so separate

The separation isn't about the problem — it's about **the tools being afraid of different things:**

| Fear | Frontend tools | Backend tools |
|------|---------------|---------------|
| **Changes/events** | Embrace reactivity but fear async (useEffect hell, race conditions) | Embrace events (Kafka, queues) but fear fine-grained reactivity (no computed/derived) |
| **Transparency** | Black-box stores — can't inspect the dependency graph at runtime | Black-box queues — can't see what's in flight, what depends on what |
| **Streaming** | Bolt-on (separate "async atom" or "query" side-car) | Native (Kafka streams, Redis streams) but no derived computation on the stream |
| **Coordination** | Diamond problem unsolved in most libs | Transactions, but no reactive graph coordination |
| **Cancellation** | Manual AbortController juggling | Consumer groups handle it, but no per-operation cancellation |

**The core insight:** Neither side has a tool that does reactive state + streaming + derived computation + cancellation + inspectability in one model. Frontend has reactivity without streams. Backend has streams without reactivity. callbag-recharge has both.

### Biggest usage patterns — Frontend

| Pattern | Example | Current tool | Pain point | callbag-recharge answer |
|---------|---------|-------------|------------|------------------------|
| **UI state** | Counter, toggle, form values | Zustand `create()`, Jotai `atom()` | Framework lock-in, no operators | `state()` — framework-agnostic, same API |
| **Derived/computed** | Filtered list, total price, validation | Zustand selector, Jotai derived atom | Glitches (diamond), manual memoization | `derived()` — diamond-safe, push-phase memoization |
| **Async data fetching** | API calls, search-as-you-type | TanStack Query, SWR, Jotai async atom | Separate "query" concept, no cancellation composition | `producer()` + `switchMap` — same graph, auto-cancel |
| **Form state** | Multi-field validation, dirty tracking | React Hook Form, Formik | Separate library, doesn't compose with app state | `state()` per field + `derived()` for validation — one model |
| **Real-time updates** | WebSocket prices, notifications | Custom hooks, socket.io | Manual event→state bridging, no operators | `producer()` from WebSocket + operators → `state()` |
| **Optimistic updates** | Instant UI, rollback on failure | TanStack Query, Redux Toolkit | Complex middleware, manual rollback | `scan()` for history + `rescue()` for rollback |
| **Complex derived graphs** | Dashboard with cross-widget deps | Redux + reselect, MobX computed | Reselect ceremony, MobX proxy magic | `derived()` chains — diamond-safe, inspectable |

**Frontend summary:** The biggest unserved need is **derived computation that's both correct (diamond-safe) and composable with async/streaming**. No current tool does both.

### Biggest usage patterns — Backend

| Pattern | Example | Current tool | Pain point | callbag-recharge answer |
|---------|---------|-------------|------------|------------------------|
| **Request-scoped state** | Auth context, request metadata | Express `req.locals`, context objects | Not reactive, manual threading | `state()` per request — reactive, inspectable |
| **Session state** | User session, shopping cart | Redis, in-memory Map | No derived computation, manual sync | `state()` + `effect()` to sync to Redis |
| **Event processing** | Kafka consumer, webhook handler | Kafka consumer groups, Bull queues | No reactive graph, manual transforms | `producer()` from Kafka + operators → `state()` |
| **Real-time aggregation** | Live dashboard, metrics | Redis streams, custom pipelines | No windowing/throttling primitives | `bufferTime()`, `scan()`, `throttle()` — built in |
| **AI/LLM orchestration** | Chat sessions, agent memory, tool calls | Custom code, LangChain state | No reactive model, manual lifecycle tracking | `memoryStore` pattern (see below) |
| **WebSocket server state** | Connected clients, room state | Socket.io rooms, custom Map | No derived computation, manual broadcast | `state()` per room + `derived()` for views |
| **Workflow orchestration** | Multi-step jobs, saga patterns | Temporal, Bull, custom state machines | Heavy infrastructure, no in-process reactivity | `state()` for step status + `effect()` for transitions |
| **Cache coordination** | Invalidation chains, computed caches | Redis + manual invalidation | No dependency tracking, stale data | `derived()` chains with `effect()` for cache write-through |
| **Rate limiting / throttling** | API rate limits, batch writes | Custom token bucket, Redis | Per-use implementation | `throttle()`, `bufferCount()` — composable |

**Backend summary:** The biggest unserved need is **in-process reactive coordination between external systems**. Backend has great durable storage (DB, queues) but no reactive layer to coordinate the in-flight state between them. Every backend team builds ad-hoc event→state→effect pipelines. callbag-recharge is what those should be.

### Why backend doesn't call it "state management"

Backend developers don't search for "state management" because:

1. **The database IS the state manager** — PostgreSQL handles consistency, transactions, derived views. For durable state, this is correct.

2. **"State management" implies client-side** — The term was claimed by frontend frameworks. Backend uses "event processing", "stream processing", "pub/sub", "message queues" — all describing the same reactive coordination problem.

3. **Backend state is distributed** — A single in-process store doesn't solve distributed state. Backend teams reach for Redis/Kafka because they need cross-process coordination.

4. **No one ships a "backend state manager"** — The gap exists but no library has named it. Tools like Temporal (workflow state), Bull (job state), and Socket.io (connection state) each solve one slice. Nobody unifies them.

**This is our opportunity.** callbag-recharge doesn't replace the database or the queue. It's the **reactive coordination layer** — the thing that sits between your external systems and makes the in-flight data flow as a graph with derived computation, cancellation, and inspectability.

### The unifying model

What if frontend state management and backend event processing are the same thing at different timescales?

```
Frontend (milliseconds):     user input → state → derived → UI render
Backend  (ms to seconds):    event arrives → state → derived → side effect
Backend  (seconds to hours): message consumed → state → derived → write to DB

Same pattern. Same graph. Same operators. Different sources and sinks.
```

callbag-recharge already works at all three timescales. The `producer()` doesn't care if the source is a button click (ms), a WebSocket message (ms-s), or a Kafka consumer (s-h). The `effect()` doesn't care if the sink is a DOM update, a Redis write, or an API call.

**The positioning:**

> "The same 5 primitives manage your UI state, your WebSocket streams, your AI agent memory, and your event pipeline. One mental model. One graph. One inspector."

### What makes this possible — Inspector as the missing piece

The reason frontend and backend tools feel separate is **lack of transparency in the flow of data.** You can't see:

- What depends on what (Zustand selectors are opaque; Kafka consumer groups are a black box)
- What's in flight (React re-renders are invisible; messages in a queue are a number)
- Why something recomputed (Jotai doesn't tell you which dep changed; Redis doesn't tell you what invalidated)
- Whether the graph is consistent (diamond glitches in frontend; stale reads in backend)

**Inspector solves all of these:**

```ts
Inspector.snapshot()   // Full graph: nodes, edges, values, statuses — JSON-serializable
Inspector.dumpGraph()  // Pretty-print: see every node, its value, its status
Inspector.observe(s)   // Watch protocol-level events: DIRTY, DATA, RESOLVED, END
Inspector.trace(s, cb) // Subscribe to value changes with name context
Inspector.getEdges()   // See the full dependency DAG
```

This works identically whether the graph manages UI state or backend event processing. An AI debugging agent can `Inspector.snapshot()` and understand the entire reactive state of your application — frontend or backend.

**Inspector is the unifying principle.** It's what makes "state management" legible regardless of where it runs. No current tool — frontend or backend — offers this level of runtime graph introspection.

---

## AI MEMORY — THE P0 USE CASE

### Three-layer memory model

AI/LLM applications need three layers of memory, each at a different timescale:

| Layer | Lifespan | Contents | Reactivity need |
|-------|----------|----------|----------------|
| **Working memory** | One turn (seconds) | Context window: system prompt + retrieved context + recent messages | Must recompute when any input changes |
| **Session memory** | One conversation (minutes-hours) | Full message history, tool call results, accumulated state | Must persist across turns, trigger retrieval |
| **Long-term memory** | Cross-session (days-forever) | User preferences, learned patterns, knowledge base | Must be queryable reactively when session context changes |

### Why this is perfectly suited to callbag-recharge

Each layer maps directly to primitives:

```ts
// ── Layer 3: Long-term memory (external, pull-reactive) ──
const userProfile = producer<UserProfile>(({ emit }) => {
  // Load from DB/vector store on session start
})
const knowledgeBase = producer<string[]>(({ emit }) => {
  // Reactive retrieval: re-query when session context changes
})

// ── Layer 2: Session memory (in-process, persisted via effect) ──
const messages = state<Message[]>([])
const toolResults = state<ToolResult[]>([])
const sessionMeta = state<SessionMeta>({ startedAt: Date.now() })

// Persist to Redis/DB reactively
effect([messages], () => redis.set(`session:${id}:messages`, messages.get()))
effect([toolResults], () => redis.set(`session:${id}:tools`, toolResults.get()))

// ── Layer 1: Working memory (derived, always consistent) ──
const relevantHistory = derived([messages], () =>
  selectRecentMessages(messages.get(), { maxTokens: 8000 })
)

const retrievedContext = derived([messages, knowledgeBase], () =>
  knowledgeBase.get().filter(k => isRelevant(k, lastMessage(messages.get())))
)

const contextWindow = derived(
  [userProfile, retrievedContext, relevantHistory],
  () => assembleContext({
    system: userProfile.get().systemPrompt,
    context: retrievedContext.get(),
    history: relevantHistory.get(),
  })
)

const tokenCount = derived([contextWindow], () => countTokens(contextWindow.get()))

// ── Reactive coordination ──

// Auto-truncate when context window exceeds limit
effect([tokenCount], () => {
  if (tokenCount.get() > 120_000) {
    messages.update(msgs => summarizeOldest(msgs))
  }
})

// Stream LLM response with cancellation
const llmResponse = pipe(
  contextWindow,
  switchMap(ctx => fromAsyncIter(llm.stream(ctx))),  // auto-cancels previous
  scan((acc, chunk) => acc + chunk, ''),              // accumulate chunks
)

// Tool call lifecycle
effect([llmResponse], () => {
  const toolCall = extractToolCall(llmResponse.get())
  if (toolCall) {
    // producer() for the tool execution, feeds back into messages
  }
})
```

**What this gives you that no current tool does:**

1. **Diamond-safe context assembly** — When a new message arrives, `relevantHistory`, `retrievedContext`, and `contextWindow` all recompute exactly once, in the right order. No glitches.

2. **Automatic cancellation** — `switchMap` cancels the in-flight LLM call when context changes. No AbortController juggling.

3. **Reactive persistence** — Session memory syncs to Redis via `effect()`. No manual "save after every operation" code.

4. **Inspectable** — `Inspector.snapshot()` shows the full memory graph: what's in the context window, token count, which messages were truncated, what's being retrieved. An AI debugging agent can see everything.

5. **One model for all three layers** — No separate "memory SDK" for each layer. `state()` for session, `derived()` for working memory, `producer()` for long-term retrieval. Same graph, same operators.

### The `memoryStore` pattern (P0 deliverable)

```ts
import { memoryStore } from 'callbag-recharge/patterns'

const memory = memoryStore({
  maxTokens: 128_000,
  persist: {
    adapter: 'redis',                          // or custom (key, value) => Promise
    key: `session:${conversationId}`,
  },
  retrieve: {
    fn: (query) => vectorDB.search(query),     // long-term retrieval
    triggerOn: 'lastMessage',                   // re-retrieve on each new message
  },
})

// Reactive stores — all inspectable
memory.messages        // WritableStore<Message[]>
memory.context         // Store<string> — assembled context window
memory.tokenCount      // Store<number> — always current
memory.retrieved       // Store<string[]> — latest retrieval results

// Actions
memory.addMessage(msg)         // triggers: persist + retrieval + context rebuild
memory.addToolResult(result)   // triggers: context rebuild
memory.clearHistory()          // triggers: persist + context rebuild

// Inspector sees everything
Inspector.dumpGraph()
// Memory Graph (7 nodes):
//   messages (state) = [Message x 12]  [SETTLED]
//   toolResults (state) = [ToolResult x 3]  [SETTLED]
//   relevantHistory (derived) = [Message x 8]  [SETTLED]
//   retrievedContext (derived) = ["...", "..."]  [SETTLED]
//   contextWindow (derived) = "You are... [context] ..."  [SETTLED]
//   tokenCount (derived) = 47832  [SETTLED]
//   persistEffect (effect)  [SETTLED]
```

---

## COMPAT LAYER STRATEGY

### Jotai compat — registry-based dep resolution

Instead of Jotai's implicit tracking via Proxy, use a WeakMap registry where atoms self-register:

```ts
// Compat layer maintains a store registry
const registry = new WeakMap<JotaiAtom, Store>()

function atom(initialOrRead, write?) {
  if (typeof initialOrRead !== 'function') {
    // Primitive atom → state()
    const s = state(initialOrRead)
    const a = { _store: s }
    registry.set(a, s)
    return a
  }

  // Derived atom: run read() once to discover deps via get() calls
  const readFn = initialOrRead
  const trackedDeps: Store[] = []

  const trackingGet = (otherAtom) => {
    const store = registry.get(otherAtom)
    trackedDeps.push(store)
    return store.get()
  }

  readFn(trackingGet)  // first run: discover deps

  // Now we have explicit deps → derived()
  const d = derived(trackedDeps, () => {
    return readFn((a) => registry.get(a).get())
  })

  const result = { _store: d }
  registry.set(result, d)
  return result
}
```

**Advantages over Proxy-based auto-tracking:**
- No Proxy overhead, no per-signal allocation
- Registry is a WeakMap — GC-friendly
- Once deps discovered → normal derived() with full diamond resolution

**Known limitation:** Dynamic deps (conditional `get()` calls) won't be tracked if the condition is false on first run. Document this; cover 90%+ of real usage. Phase 2 can add re-tracking.

**Separate from Inspector:** The registry is a compat-layer runtime concern. Inspector is opt-in observability. Same WeakMap pattern but different lifecycle. Don't couple them.

### Zustand compat — match StoreApi for middleware

Match Zustand's `StoreApi<T>` contract exactly:

```ts
interface StoreApi<T> {
  setState: (partial: T | Partial<T> | ((s: T) => T | Partial<T>), replace?: boolean) => void
  getState: () => T
  getInitialState: () => T
  subscribe: (listener: (state: T, prevState: T) => void) => () => void
}
```

If we match this, Zustand middleware (persist, devtools, immer) works because middleware only wraps this interface — it doesn't reach into Zustand internals. ~150-200 LOC.

### `createStore()` — native pattern for single-store users

For Zustand/Redux users who want the familiar single-store + selectors pattern but with callbag-recharge advantages:

```ts
const store = createStore({
  count: 0,
  name: 'Alice',
  increment: (get, set) => set('count', get('count') + 1),
})

store.select(s => s.count)    // → derived() store, diamond-safe
store.getState()              // full object
store.setState({ count: 5 }) // shallow merge
```

Internally: one `state()` + `derived()` per selector. Users get diamond-safe selectors without reselect.

---

## REJECTED ALTERNATIVES

### "Just wrap Redis/Kafka with callbag sources"
Why not: This positions us as a "connector library" (like Kafka Connect). That's commodity. The value is the reactive graph + derived computation + inspectability on top.

### "Ship separate frontend and backend packages"
Why not: Splits the story. The whole point is one mental model. One import. The framework-agnostic core IS the unification.

### "Use Inspector as the Jotai compat registry"
Why not: Inspector is opt-in observability with "zero intrusion" contract. A compat registry is a runtime dependency. Same pattern (WeakMap), different concern. Keep separate.

### "Add implicit tracking to core derived()"
Why not: Explicit deps is a design principle (Session 47f1a07f). Implicit tracking goes in compat layers only. Core stays explicit.

---

## KEY INSIGHT

**Frontend and backend state management are the same problem at different timescales.** The tools feel separate because each side is afraid of what the other side embraces: frontend fears async/streaming, backend fears fine-grained reactivity. callbag-recharge bridges both because the callbag protocol doesn't distinguish between a button click and a Kafka message — they're both type 1 DATA.

**Inspector is the unifying principle.** The reason these worlds feel opaque is lack of runtime graph visibility. Inspector makes every reactive relationship visible — whether it's a UI selector chain or a backend event pipeline. "You don't guess what's happening — you see it."

**AI memory is the P0 application** because it naturally spans all three timescales (working memory in ms, session memory in minutes, long-term memory in days) and all three layers need reactive coordination that no current tool provides.

## PRIORITY

| Deliverable | Priority | Effort | Why |
|-------------|----------|--------|-----|
| `memoryStore` pattern | **P0** | ~3 days | First mover in "AI memory state management" — no competitor has this |
| `createStore()` pattern | **P1** | ~2 days | Attracts largest user segment (Zustand/Redux single-store users) |
| Nanostores compat | **P1** | ~1 day | Trivial, validates compat pattern |
| Zustand vanilla compat (StoreApi) | **P2** | ~2-3 days | Middleware "free" if we match contract |
| TC39 Signals compat | **P2** | ~1-2 days | Future-proofing |
| Jotai compat (registry-based) | **P2** | ~2-3 days | Largest atomic-model competitor |
| Backend positioning docs + recipes | **P1** | ~2 days | GEO for uncontested "reactive backend" queries |

## FILES CHANGED

- This file created: `src/archive/docs/SESSION-unified-state-management.md`

---END SESSION---
