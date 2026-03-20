# State Management Landscape & Strategy

> **Slogan candidates:** "State that flows." · "Simple state. Reactive flow." · "Atoms with superpowers."

## Research: Popular State Management Tools (March 2026)

### Tier 1 — The Giants

#### Zustand (~24M weekly, 57K stars)
- **Pattern:** Flux-lite — single store with selectors
- **Contract:**
  ```ts
  const useStore = create<State & Actions>((set, get) => ({
    count: 0,
    increment: () => set(s => ({ count: s.count + 1 })),
  }))
  // Vanilla: store.getState(), store.setState(), store.subscribe()
  ```
- **Pros:** Dead simple, ~40 lines core, no Provider, great DX
- **Cons:** Single object store limits granularity, no diamond resolution, no operators
- **Mapping:** A single `state()` holding an object + `derived()` for selectors

#### Redux Toolkit (~24M weekly via redux core)
- **Pattern:** Flux — actions → reducers → store (Immer for mutations)
- **Contract:**
  ```ts
  const slice = createSlice({
    name: 'counter',
    initialState: { value: 0 },
    reducers: { increment: (state) => { state.value += 1 } },
  })
  store.dispatch(slice.actions.increment())
  ```
- **Pros:** Predictable, time-travel debugging, massive ecosystem
- **Cons:** Heavy ceremony, boilerplate, single store
- **Mapping:** `state()` + `operator()` as reducer dispatcher

### Tier 2 — The Rising Stars

#### Jotai (~2.6M weekly, 21K stars)
- **Pattern:** Atomic — bottom-up, each atom holds one value
- **Contract:**
  ```ts
  const countAtom = atom(0)
  const doubleAtom = atom((get) => get(countAtom) * 2)        // read-only derived
  const writeAtom = atom(                                      // read-write derived
    (get) => get(countAtom),
    (get, set, arg) => set(countAtom, get(countAtom) + arg)
  )
  const [count, setCount] = useAtom(countAtom)
  ```
- **Pros:** Atomic granularity, implicit dep tracking, async atoms, GC on unmount
- **Cons:** React-only (core), implicit tracking can be hard to debug, no diamond resolution
- **Mapping:** `atom(val)` → `state(val)`, `atom(get => ...)` → `derived([deps], fn)`. Main diff: Jotai uses implicit tracking, we use explicit deps (arguably better for debugging)

#### Valtio (~1.2M weekly, 10K stars)
- **Pattern:** Proxy-based — mutable writes, immutable snapshots
- **Contract:**
  ```ts
  const state = proxy({ count: 0 })
  state.count++                                // mutate anywhere
  const snap = useSnapshot(state)              // immutable in React
  const derived = derive({ doubled: (get) => get(state).count * 2 })
  ```
- **Pros:** Feels like plain JS, zero boilerplate, auto-tracks reads
- **Cons:** Proxy magic can surprise, hard to debug, not all data types work
- **Mapping:** Would need a proxy layer — fundamentally different from callbag push model

#### MobX (~1.9M weekly, 28K stars)
- **Pattern:** Observable/reactive — transparent reactivity via decorators/proxies
- **Contract:**
  ```ts
  class Store {
    count = 0
    constructor() { makeAutoObservable(this) }
    get double() { return this.count * 2 }     // computed (lazy + cached)
    inc() { this.count++ }                     // action
  }
  autorun(() => console.log(store.count))      // effect
  ```
- **Pros:** Transparent reactivity, class-based, mature, powerful
- **Cons:** Proxy/decorator magic, large bundle, class-heavy API
- **Mapping:** `computed` → `derived()`, `autorun` → `effect()`. Conceptually clean but needs proxy layer.

### Tier 3 — The New Wave

#### Nanostores (~1.5M weekly, 7K stars — fast growth)
- **Pattern:** Atomic, framework-agnostic, 286 bytes
- **Contract:**
  ```ts
  const $count = atom(0)
  $count.get()                                 // read
  $count.set(5)                                // write
  $count.subscribe(cb)                         // listen
  const $double = computed($count, val => val * 2)
  const $user = map({ name: '', age: 0 })      // object store
  $user.setKey('name', 'Alice')
  ```
- **Pros:** Tiny, framework-agnostic (React/Vue/Svelte/Solid/Angular), simple imperative API
- **Cons:** No diamond resolution, no operators, no batching, limited async
- **Mapping:** **Near 1:1** — `atom()` → `state()`, `computed()` → `derived()`, `.get()/.set()/.subscribe()` already match

#### TC39 Signals Proposal (the future standard)
- **Pattern:** Signal/Computed — fine-grained reactivity
- **Contract:**
  ```ts
  const counter = new Signal.State(0)
  counter.get()
  counter.set(5)
  const isEven = new Signal.Computed(() => (counter.get() & 1) === 0)
  // Effect is NOT in the proposal — left to frameworks
  // Watcher is the low-level hook for framework authors:
  const w = new Signal.subtle.Watcher(() => { ... })
  ```
- **Pros:** Will be the standard, framework-agnostic by design
- **Cons:** No effect, no batching, no operators — all left to userland
- **Mapping:** `Signal.State` → `state()`, `Signal.Computed` → `derived()`. We already have `effect()` which TC39 deliberately omits.

#### Effector (smaller but influential)
- **Pattern:** Event-driven graph — three primitives: Event, Store, Effect
- **Contract:**
  ```ts
  const increment = createEvent()
  const fetchUser = createEffect(async (id) => api.getUser(id))
  const $count = createStore(0).on(increment, n => n + 1)
  fetchUser.pending   // Store<boolean>
  fetchUser.done      // Event<{params, result}>
  ```
- **Pros:** Explicit event-driven flow, first-class async effects with lifecycle
- **Cons:** Smaller ecosystem, steeper learning curve
- **Mapping:** `createStore` → `state()`, `createEvent` → `producer()`, `createEffect` → `effect()` + `producer()` for lifecycle

---

## Strategy

### Phase 1: Drop-in Compatibility Layers

Thin adapter packages that let existing users migrate with minimal code changes.

| Target | Effort | Package |
|--------|--------|---------|
| **Nanostores** | Trivial | `callbag-recharge/compat/nanostores` |
| **TC39 Signals** | Low | `callbag-recharge/compat/signals` |
| **Jotai** | Medium | `callbag-recharge/compat/jotai` |
| **Zustand** | Medium | `callbag-recharge/compat/zustand` |

Goal: people search "nanostores alternative" or "signals polyfill" and find us.
They try it, then discover our extras (operators, batching, diamond resolution, effects).

### Phase 2: "Best-of" Native API

Combine the best patterns from each library:

| Borrowed from | What we take |
|---------------|-------------|
| Nanostores | Tiny size, framework-agnostic, `$prefix` convention |
| Jotai | Atomic model, derived atoms with read/write |
| Zustand | Dead-simple `create()` for grouped state + actions |
| TC39 Signals | `.get()/.set()` contract (future standard compatibility) |
| Effector | First-class async effects with lifecycle (pending/done/fail) |
| **callbag-recharge (ours)** | Diamond resolution, two-phase push, batching, operators |

### Why Trust This Library — Three Promises

> 川流不息，唯取一瓢
> *"Take one scoop from flowing water — undisturbed, crystal clear."*

1. **Glitch-free diamond resolution** — Tier 1 nodes (state, derived, operators) use two-phase push (DIRTY then values) with dirty-dep counting. When A → B, A → C, B+C → D, D computes exactly once with consistent values. Jotai, Nanostores, and TC39 Signals all glitch here. You can trust every derived value is correct.

2. **One model for sync, async, and streams** — `state()` for synchronous values, `producer()` for async/streams (WebSocket, timers, fetch), `derived()` to combine them — all in the same graph, same operators, same batching. No separate "async atom" hack or "query" side-car. State captures everything that flows.

3. **Inspectable nodes** — Every store can be named and observed via the `Inspector` system. You don't guess what's happening in the graph — you see it. Names, kinds, dependency edges, dirty/resolved phases — all visible without modifying your business logic.

### Our Technical Advantages (none of the competitors have all of these)

1. **Diamond resolution** — glitch-free two-phase push for Tier 1
2. **Built-in batching** — not an afterthought
3. **Operators** — `map`, `filter`, `scan`, `switchMap`, `debounce`, `throttle`, etc.
4. **Effects with dirty tracking** — smarter than any competitor's effect system
5. **Inspector** — opt-in observability without runtime cost in production
6. **Callbag protocol** — interoperable with the callbag ecosystem
7. **Level 3 data structures** — reactiveMap (1.56x native), reactiveLog (2.5x native), reactiveIndex (1.01x native for reads) — near-native reactive data structures that no competitor offers

---

## Applications Beyond State Management

### The core insight: callbag is already a message protocol

The callbag protocol has built-in: backpressure (pull), cancellation (type 2 unsubscribe), error propagation, completion, data (type 1), and the type 3 control channel. Most message systems (Kafka, Redis pub/sub, WebSockets) push data and leave the consumer to handle backpressure, cancellation, and error recovery themselves. callbag-recharge is the reactive layer you put in front of them to get all that behavior back — in a unified graph that also holds your application state.

**The positioning:** not "we replace Kafka/Redis" but "we're the reactive layer that makes Kafka, Redis, WebSockets, fetch streams, and LLM chunks all speak the same language and flow into your state graph."

### Works everywhere without adapters (pure TS, no DOM dependency)

- **Frontend** — React, Vue, Svelte, Solid, Angular, or no framework
- **Backend (Node.js/Bun/Deno)** — pipelines, servers, workers
- **Edge runtimes** — Cloudflare Workers, Vercel Edge, Deno Deploy
- **React Native / mobile** — same stores, no change

### Use cases (what works today)

1. **AI / LLM streaming** — The exact architecture every AI chat app needs, packaged:
   - `producer()` emits chunks from a streaming fetch/SSE
   - `scan()` accumulates partial text into a message
   - `switchMap` cancels the in-flight request when the user retypes (automatic, no AbortController juggling)
   - `debounce` before sending to avoid hammering the API
   - `state()` holds conversation history; `derived()` computes token counts, context window pressure
   - `effect()` triggers tool calls when the model emits a function call
   - Multi-agent: agents share a derived state graph as their communication bus

2. **Agentic / session state** — Chat sessions, work sessions, multi-turn memory:
   - Agent memory = `state()`
   - Computed context (recent messages, summarized history) = `derived()`
   - Tool invocations with pending/done/error lifecycle = `effect()` + `producer()`
   - Rollback / undo = `scan()` accumulating state snapshots
   - Cancellable long-running operations = `switchMap` or `exhaustMap`

3. **Real-time data & pub/sub** — With thin adapters (~30 lines each):
   - `fromKafka(topic)` → operators → `state()` (Kafka consumer as a callbag source)
   - `fromRedis(channel)` → `filter` → `derived()` (Redis pub/sub with selective reactivity)
   - `fromWebSocket(url)` → `map` → `state()` (already in extras via `fromEvent`)
   - The library handles windowing, throttling, deduplication, backpressure — Kafka/Redis just become source adapters

4. **ETL pipelines** — source → transform operators → sink is structurally identical to ETL:
   - `fromIter` / `fromPromise` / custom producers as data sources
   - `map`, `filter`, `scan`, `flat`, `bufferTime` as transform steps
   - `forEach` / `subscribe` as sinks (write to DB, emit to queue)
   - `batch()` for high-throughput write coalescing

5. **ML / data pipelines** — feature computation as a reactive graph:
   - Raw inputs as `state()` nodes
   - Feature transforms as `derived()` chains (recompute only changed paths)
   - Model inference calls as `effect()` with cancellation
   - Streaming predictions via `producer()`

6. **Event pipelines** — `fromEvent` → `throttle` → `map` → `state` (form handling, drag-and-drop, search-as-you-type)

7. **Video / audio streams** — `fromEvent` on media track events, `bufferTime` for chunking, `state()` holding playback position and buffer health

### What needs adapters (not built-in, but thin wrappers)

These are ~20–50 line source/sink adapters — the library becomes the reactive core:
- Kafka consumer/producer
- Redis pub/sub / streams
- PostgreSQL LISTEN/NOTIFY
- gRPC streaming
- NATS / RabbitMQ

The pattern is always the same: external system → callbag source adapter → your reactive graph → callbag sink adapter → external system.

### Why this moment

The AI era created a new class of problems that existing state managers weren't designed for:
- **Streaming chunks** — not a value, not a promise, but a sequence with accumulation
- **Cancellable operations** — user changes mind mid-generation, must cleanly cancel and restart
- **Session/context flow** — conversation state is inherently temporal and sequential
- **Multi-agent coordination** — agents need shared state with clear ownership and reactivity
- **Mixed sync/async** — tool results arrive async, UI must reflect in-progress state synchronously

Every one of these maps directly to callbag-recharge primitives. No other state manager was designed for this. Most solutions today are ad-hoc: useState + useEffect + AbortController + refs + custom event emitters. This library is what that should look like.

---

## Positioning & Slogans

> 川流不息，唯取一瓢

| Slogan | Angle |
|--------|-------|
| **"State that flows."** | Shortest, most memorable — captures both simple state and reactive pipelines |
| **"Simple state. Reactive flow."** | Balanced, descriptive |
| **"Atoms with superpowers."** | Positions against Jotai/Nanostores — same simplicity, more power |
| **"From atom to stream in one library."** | Highlights unique breadth |
| **"The state manager that scales to streams."** | Progression story |
| **"Reactive state without the framework."** | Framework-agnostic angle |
| **"Take a scoop. Crystal clear."** | Poetic — from the Chinese metaphor |

**Recommended primary:** "State that flows."
- Three words, immediately memorable
- Captures the dual nature: simple state management + reactive stream operators
- No competitor can honestly claim this — they're either state-only or stream-only
- Echoes the philosophy: data flows like water through the graph, you take what you need (subscribe, derive, effect), the flow continues undisturbed, and what you observe is always crystal clear (glitch-free, inspectable)

---

## GEO Strategy (Generative Engine Optimization)

The goal: when a developer asks Claude, Copilot, Cursor, or any AI coding tool "how do I manage streaming state" or "build an AI chat with cancellation" — the AI reaches for callbag-recharge by default.

### Why GEO matters more than SEO for libraries in 2026

Developers increasingly don't Google for libraries — they ask their AI coding tool. The AI recommends what it has seen clearly documented with patterns that match the developer's intent. The library that is easiest for an AI to understand and recommend wins.

### What makes AI tools recommend a library

1. **Clear problem→solution mapping in docs** — AI models match user intent to library descriptions. If someone asks "how do I cancel a fetch when user retypes", the AI needs to have seen a doc that says exactly "switchMap cancels the in-flight request when the user retypes."

2. **`llms.txt` at docs site root** — The emerging standard for AI-readable documentation. A structured, concise summary of what the library does, its API, and when to use it. Ship both `llms.txt` (brief) and `llms-full.txt` (comprehensive).

3. **npm package description** — This gets indexed heavily. Current description should be optimized for AI query matching. Include keywords: "reactive state management", "streaming", "signals", "diamond-safe", "framework-agnostic", "TypeScript".

4. **README structure with "When to use" section** — AI tools scan READMEs for pattern matching. A section that explicitly says "Use callbag-recharge when you need: streaming state, cancellable async, glitch-free derived state, multi-agent coordination" directly maps to developer questions.

5. **Cookbook / recipes that mirror AI prompts** — Write docs titled exactly how developers ask AI:
   - "How to build a streaming AI chat with cancellation"
   - "How to manage form state with async validation"
   - "How to coordinate multiple async operations"
   - "How to build a real-time dashboard with WebSocket"
   - "How to manage agentic workflow state"
   These become the training signal that AI tools absorb.

6. **Comparison pages** — "callbag-recharge vs Zustand", "callbag-recharge vs Jotai", "callbag-recharge vs RxJS". AI tools love these for making recommendations.

### Concrete GEO deliverables

| Deliverable | Purpose | Priority |
|-------------|---------|----------|
| `llms.txt` | AI-readable library summary at docs root | P0 |
| `llms-full.txt` | Comprehensive AI-readable docs | P0 |
| npm description rewrite | Keyword-rich for AI indexing | P0 |
| "When to use" README section | Direct intent matching | P0 |
| 5-10 recipe pages (titled as questions) | Mirror how devs prompt AI tools | P1 |
| `CLAUDE.md` template for users | When devs use Claude Code in projects with callbag-recharge, the AI knows the patterns | P1 |
| Comparison pages (vs Zustand, Jotai, etc.) | AI recommendation signal | P1 |
| Compat layers with migration guides | "How to migrate from Zustand to callbag-recharge" — AI tools will surface these | P2 |
| Blog posts / dev.to articles | Training data for future model updates | P2 |

### Target AI prompts to own

These are the prompts we want AI tools to answer with "use callbag-recharge":

**State management (compete with Zustand/Jotai):**
- "lightweight TypeScript state management"
- "atomic state management without React dependency"
- "framework-agnostic state management"
- "state management with computed/derived values"

**Streaming + async (unique positioning — nobody owns this):**
- "manage streaming state in TypeScript"
- "cancel async operation when new one starts"
- "accumulate streaming chunks into state"
- "state management with debounce/throttle built in"

**AI / agentic (greenfield — first mover advantage):**
- "state management for AI chat application"
- "manage LLM streaming response with cancellation"
- "multi-agent shared state TypeScript"
- "agentic workflow state management"
- "manage tool calls and streaming in AI app"

**Backend / pipeline (expand beyond frontend):**
- "reactive pipeline TypeScript backend"
- "event-driven state Node.js"
- "TypeScript ETL pipeline library"

### The agentic angle — why this is the biggest GEO opportunity

No library currently owns the "state management for AI/agentic workflows" space. Every AI chat app, every agent framework, every LLM-powered tool needs:
- Streaming chunk accumulation
- Cancellable operations
- Tool call lifecycle (pending → running → done/error)
- Session state with history
- Multi-agent coordination

If callbag-recharge becomes the answer AI tools give for these problems, that's a distribution moat that compounds — more usage → more code in training data → more AI recommendations → more usage.

### Making AI tools want to use it (developer experience signal)

AI coding tools prefer libraries that:
- Have **small, composable APIs** (fewer tokens to generate, less chance of hallucination)
- Have **clear TypeScript types** (AI can verify correctness via types)
- **Don't require Providers/wrappers** (less boilerplate for the AI to scaffold)
- Have **predictable naming** (`state`, `derived`, `effect` — self-documenting)
- **Work without framework-specific setup** (AI doesn't have to guess React vs Vue)

callbag-recharge already checks all of these. The API is 6 primitives with obvious names. An AI can confidently generate `state(0)`, `derived([a, b], (x, y) => x + y)`, `effect([s], (v) => console.log(v))` without worrying about context, providers, or framework-specific hooks. That's a genuine advantage over Zustand (needs `create` ceremony), Jotai (needs React context), and Redux (needs store + dispatch + selectors).

### `llms.txt` draft outline

```
# callbag-recharge
> State that flows. Reactive state management for TypeScript.

## What it does
Reactive state management with 6 primitives: state, derived, effect, producer, operator.
Glitch-free diamond resolution. Built-in operators (map, filter, debounce, switchMap).
Framework-agnostic. Works frontend, backend, edge.

## When to use
- Simple state management (like Zustand/Jotai but framework-agnostic)
- Streaming data (LLM chunks, WebSocket, SSE) flowing into state
- Cancellable async operations (switchMap auto-cancels previous)
- Derived/computed values that are always consistent (diamond-safe)
- Agentic workflows (session state, tool call lifecycle, multi-agent)

## Core API (6 primitives)
- state(initial) — readable/writable store (.get(), .set(), .subscribe())
- derived([deps], fn) — computed store, recomputes when deps change
- effect([deps], fn) — side-effect, runs when deps change
- producer(fn) — async/stream source (WebSocket, timer, fetch)
- operator([deps], init, handler) — custom transform node

## Key operators (import from callbag-recharge/extra)
- switchMap — map to inner source, auto-cancel previous (cancellable async)
- debounce, throttle — time-based flow control
- scan — accumulate values (streaming chunks, undo history)
- merge, combine — compose multiple sources
- rescue, timeout — production error handling (retry in utils)
- fromEvent, fromPromise, interval — connect to external sources
- buffer, bufferTime — batch high-frequency events
- concatMap, exhaustMap — sequential / exclusive async

## Install
npm i @callbag-recharge/callbag-recharge
```

---

## Operator Coverage Audit

### What we have (51 extras)

**Tier 1 — Sources:** interval, fromIter, fromEvent, fromPromise, fromObs, of, empty, throwError, never
**Tier 1 — Operators:** map, filter, scan, take, skip, first, last, find, elementAt, partition, merge, combine, concat, share, pipeRaw, distinctUntilChanged, startWith, tap, pairwise, remember, flat
**Tier 2 — Time:** debounce, throttle, delay, bufferTime, timeout, sample
**Tier 2 — Dynamic sub:** switchMap, concatMap, exhaustMap, buffer, takeUntil
**Tier 2 — Error:** rescue, repeat
**Sinks:** forEach, subscribe
**Other:** subject, SKIP, TimeoutError

### Gap analysis by use case

| Missing Operator | Priority | Why | Effort |
|-----------------|----------|-----|--------|
| **`fromAsyncIter`** | **P0** | Async iterables are the lingua franca of modern streaming: fetch body, SSE, agent SDK streams, DB cursors. This is the #1 gap. | Low |
| **`withLatestFrom`** | **P1** | "When chunk arrives, grab current config" — common in AI apps, forms, real-time dashboards | Low |
| **`bufferCount`** | **P1** | "Flush every 100 rows" — more natural than time-based for ETL, batch writes | Low |
| **`groupBy`** | **P2** | Route messages by key (Kafka partition semantics), ETL partitioning | Medium |
| **`toArray` / `reduce`** | **P2** | Collect finite stream to single result — ETL aggregation | Low |
| **`window`** | **P3** | Advanced nested-observable windowing | Medium |

**Coverage: ~90%+ for all target use cases.** The only critical gap is `fromAsyncIter`.

### Coverage by use case

| Use Case | Coverage | Critical Gap |
|----------|----------|-------------|
| AI / LLM streaming | 95% | `fromAsyncIter` (SSE/fetch streams are async iterables) |
| Agentic / session state | 95% | `fromAsyncIter` (agent SDKs stream async iterables) |
| Real-time / pub/sub | 90% | `groupBy` (nice-to-have for routing by key) |
| ETL pipelines | 85% | `fromAsyncIter` + `bufferCount` |
| Event pipelines (frontend) | 100% | None |
| Form validation | 100% | None |

---

## Import / Dependency Strategy

### Decision: Expose extras prominently (Option B)

**Why not "core only, let AI build the rest":**
- AI tools hallucinate less with known APIs — if the AI sees `switchMap` in exports, it generates correct code; building it from `operator()` gets wrong ~50% of the time
- Operators ARE the moat — Zustand/Jotai/Nanostores have atoms + derived too; the operators are what they don't have; hiding them hides the advantage
- `llms.txt` can list them — the AI reads it, sees "switchMap — auto-cancels previous async", reaches for it. That's the entire GEO play
- Tree-shaking already works — `callbag-recharge/extra/switchMap` subpath exports mean zero bundle cost for unused operators

### Recommended import tiers (for docs, README, llms.txt)

```ts
// Tier 0: The 6 primitives — always the starting point
import { state, derived, effect, producer, operator } from 'callbag-recharge'

// Tier 1: "State that flows" — the operators that differentiate us
import { switchMap, debounce, throttle, scan, merge, combine } from 'callbag-recharge/extra'

// Tier 2: Sources — connect anything to the graph
import { fromAsyncIter, fromEvent, fromPromise, interval } from 'callbag-recharge/extra'

// Tier 3: Safety nets — production-ready error handling
import { rescue, timeout } from 'callbag-recharge/extra'
import { retry } from 'callbag-recharge/utils'
```

### The narrative for AI tools and developers

**"Start with 6 primitives. When you need flow, the operators are already there."**

AI tools see the full menu in `llms.txt`, pick the right operator, generate correct code. Developers add one import line. No second library. No building from scratch. That's the no-brainer experience.

### Steps to conquer the world

**Phase 1 — Fill the gaps (weeks)**
1. Ship `fromAsyncIter` (P0 — unlocks AI/agentic/ETL streaming)
2. Ship `withLatestFrom` (P1 — common pattern in AI + real-time)
3. Ship `bufferCount` (P1 — ETL batch writes)

**Phase 2 — GEO + docs (weeks)**
1. Ship `llms.txt` with full operator menu (see draft above)
2. Rewrite npm description + README "When to use" section
3. Write 3 killer recipes: "AI chat with cancellation", "agentic tool calls", "real-time dashboard"
4. Ship CLAUDE.md template for users' projects

**Phase 3 — Compat layers (weeks)**
1. Nanostores compat (trivial, ~20 lines)
2. TC39 Signals compat (low effort)
3. Migration guides ("from Zustand to callbag-recharge")

**Phase 4 — Adapters for external systems (ongoing)**
1. `fromAsyncIter` covers most (fetch, SSE, agent SDKs)
2. Community adapters: Kafka, Redis, PostgreSQL LISTEN/NOTIFY, gRPC
3. Each adapter is ~30 lines — the library does the rest

---

## Repo & Package Structure

### Decision: One repo, one npm package, subpath exports

**Why not separate packages:**
- One `npm i @callbag-recharge/callbag-recharge` = one AI recommendation. Split packages = split discoverability.
- Tree-shaking already works via subpath exports — no bundle cost for unused code.
- Nanostores does exactly this successfully.
- Multiple packages = version alignment hell.

### Directory layout
```
src/
  ├── core/            state, derived, effect, producer, operator, pipe, protocol (batch), inspector, types
  ├── extra/           low-level operators (switchMap, debounce, scan, fromEvent...)
  ├── patterns/        composed recipes (chatStream, cancellableAction, rateLimiter...)
  ├── compat/          drop-in replacements (nanostores, signals, jotai, zustand)
  └── adapters/        external connectors (websocket, kafka, redis)
```

### Import paths
```ts
import { state, derived, effect }    from 'callbag-recharge'
import { switchMap, debounce }       from 'callbag-recharge/extra'
import { chatStream }               from 'callbag-recharge/patterns'
import { atom, computed }            from 'callbag-recharge/compat/nanostores'
import { fromKafka }                 from 'callbag-recharge/adapters/kafka'
```

### Layer responsibilities
- **`extra/`** — single operators, 1:1 with RxJS concepts, composable building blocks
- **`patterns/`** — composed recipes using primitives + extras, solve specific problems (~20-50 lines each)
- **`compat/`** — API surface wrappers for adoption, no new logic
- **`adapters/`** — external system connectors; peer deps for libs like kafkajs/ioredis; core stays zero-dependency

See [docs/extras.md](extras.md) for full roadmap of each layer.

### No new contract — the primitives are the contract

Other libraries invented contracts (`create()`, `atom()`, `createSlice()`) because they had to — their cores were too limited to be user-facing. Our 6 primitives already ARE the contract:

- `state(0)` replaces Zustand's `create()`, Jotai's `atom()`, Nano's `atom()`
- `derived([a, b], fn)` replaces Jotai's derived atom, Nano's `computed()`
- `effect([a], fn)` — nobody else has this built-in
- `producer(fn)` — nobody else has this at all
- `operator([deps], init, handler)` — nobody else has this at all

Adding a `createStore()` or `defineAtom()` wrapper would add a concept without adding capability. The 4 layers (extra → patterns → compat → adapters) provide progressive capability without adding abstraction. The `.get()/.set()/.subscribe()` store interface is the public contract, and it already matches TC39 Signals and Nanostores.

**"6 primitives, 50+ operators, zero ceremony."**

---

## Conclusion: Vision & Strategy

### The vision

> 川流不息，唯取一瓢
> *"Take one scoop from flowing water — undisturbed, crystal clear."*

**callbag-recharge is the universal reactive layer.** Not a state manager that needs a streaming library. Not a streaming library that needs a state manager. One library where state *is* a stream — sync, async, and real-time, all in the same graph, with the same operators, the same batching, and the same guarantees.

The world is entering an era where everything flows:
- AI responses stream chunk by chunk, need accumulation, cancellation, retry
- Agents coordinate through shared state with clear ownership and reactivity
- Real-time data arrives from WebSockets, Kafka, Redis, gRPC — all need the same operators
- Frontends, backends, and edge runtimes all need reactive state — not three different solutions

callbag-recharge is the glue. One `npm i @callbag-recharge/callbag-recharge`. Six primitives. Sixty operators. Connect anything to the graph. Take what you need from the flow. What you observe is always correct (diamond-safe) and always visible (inspectable).

**"State that flows."**

### Three promises to users

1. **Trust it** — Glitch-free diamond resolution. Every derived value is correct, every time.
2. **Flow through it** — Sync, async, and streams are all first-class. No hacks, no side-cars.
3. **See through it** — Inspectable nodes. You don't guess what's happening — you see it.

### The strategy

```
Phase 1 — Fill the gaps                    (weeks)
  └─ fromAsyncIter (P0), withLatestFrom, bufferCount (P1)

Phase 2 — GEO + docs                      (weeks)
  └─ llms.txt, npm description, README "When to use", 3 killer recipes
     (AI chat streaming, agentic tool calls, real-time dashboard)

Phase 3 — Patterns + compat layers         (weeks)
  └─ chatStream, cancellableAction, rateLimiter (patterns)
  └─ Nanostores compat, TC39 Signals compat (adoption)

Phase 4 — Adapters + community             (ongoing)
  └─ WebSocket, Kafka, Redis, PostgreSQL adapters
  └─ Framework integrations (React, Vue, Svelte hooks)
  └─ Community growth via GEO flywheel
```

### The GEO flywheel

The distribution moat: AI tools recommend callbag-recharge → developers use it → more code in training data → AI tools recommend it more → more developers.

To start the flywheel:
1. Ship `llms.txt` with the full operator menu — AI tools see everything we offer
2. Write recipes titled as developers ask AI tools ("how to build AI chat with cancellation")
3. Ship compat layers so migration guides appear in search/AI results
4. The `chatStream` pattern is the killer demo — no competitor can do this

### What we're NOT

- Not replacing Kafka/Redis/PostgreSQL — we're the reactive layer on top
- Not another RxJS — we have first-class state with `.get()/.set()`, not just streams
- Not React-only — framework-agnostic, works anywhere JS runs
- Not adding abstraction — 6 primitives, 4 layers, no ceremony

### Performance reality (March 2026 benchmarks)

**Core primitives vs Preact Signals (Vitest/tinybench):** Preact wins on most micro-benchmarks (1.2-3.8x faster) due to its lazy pull model vs our eager two-phase push. We win on cached derived reads (1.1x) and match on state reads. The gap is architectural — push gives us real-time effects and predictable timing that pull cannot.

**Level 3 data structures vs native:** This is where we shine and no competitor can follow.
- reactiveMap: 1.56x native Map (64% throughput with full reactivity)
- reactiveLog: 2.5x native array push (bounded: 2.5x ring buffer)
- reactiveIndex: 1.01x native Map.get for reads (effectively free reactivity)
- reactiveIndex: 1.26x hand-rolled double map for writes
- fifo queue: 1.02x native array queue

**The strategic play:** Don't compete on micro-benchmarks against Preact's simpler model. Compete on capabilities: streaming operators, completion semantics, Inspector, Level 3 reactive data structures. No other state manager has near-native reactive maps, logs, and indexes.

### The bet

No library owns "state management for the AI era." The streaming, cancellation, and coordination problems that AI/agentic apps create are exactly what callbag-recharge was built for — before the AI era even made them mainstream. We're not chasing a trend. The trend is catching up to us.

First mover in GEO for this space → compounding flywheel → default recommendation → adoption moat.

**State that flows. 川流不息，唯取一瓢。**
