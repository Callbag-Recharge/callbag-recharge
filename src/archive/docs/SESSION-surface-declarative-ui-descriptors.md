# SESSION: Surface — Declarative UI Descriptors

**Date:** 2026-03-25
**Topic:** Lightweight spontaneous UI for presenting orchestrate/messaging/jobQueue/LLM results without users learning callbag internals

---

## Context

User explored A2UI (Google's Agent-to-User Interface protocol, Dec 2025) and the broader generative UI trend (AG-UI, Vercel streamUI, Thesys/Crayon C1). The question: should callbag-recharge adopt one of these protocols, or build something native?

### Research Findings (A2UI / Generative UI Landscape)

**What A2UI is:** Google open-source spec (v0.8) where AI agents emit declarative JSON describing UI surfaces. Client-side renderers (Lit, Angular, Flutter) render natively. Agent describes structure; client owns rendering, styling, branding. Data, not code, crosses trust boundaries.

**Industry convergence on three layers:**
1. **Transport:** AG-UI (CopilotKit) — how agent state streams to frontend
2. **UI description:** A2UI — what the UI looks like, as declarative data
3. **Rendering:** Client-owned (React, Lit, Flutter render with their own components)

**Key players:** Google (A2UI), CopilotKit (AG-UI, adopted by Oracle/Microsoft), Vercel (streamUI), Thesys/Crayon (C1 API), Anthropic (Claude Artifacts).

**Pain points solved:** Presenting orchestration results without manual UI wiring; reducing learning curve for new libraries; dynamic UI that matches the task.

**Pain points NOT solved:** Design consistency, non-determinism, latency (LLM round-trip), complex stateful apps, testing/QA for non-deterministic UI, user trust.

---

## Decision: Don't Lock In — Build a Native Abstraction

### Why Not Lock In

- **Specs are immature:** A2UI v0.8, AG-UI months old — both will break.
- **callbag-recharge IS the state layer.** No need for someone else's transport. Stores already push reactive updates.
- **Target audience is JS/TS devs.** They don't need a cross-platform JSON protocol designed for agent trust boundaries.
- **Escape cost is zero** if we own the descriptor shape. Adding `toA2UI()` / `toAgUI()` adapters later is a trivial transform.

### The Pattern: State Emits What To Show

The insight worth stealing from A2UI isn't the protocol — it's the pattern: **state emits a description of what to show, not how to show it.**

---

## Design: `surface()` Primitive

### Core Idea

`surface()` is a `derived()` that maps store state → declarative UI descriptor. It returns a `Store<SurfaceDescriptor>` — a regular callbag source. No new protocol. No new runtime.

```ts
// Pipeline already has the state
const job = pipeline([fetchData, transform, validate]);

// surface() derives a UI descriptor from any store
const ui = surface(job, (snapshot) => ({
  type: "progress",
  steps: snapshot.steps.map(s => ({
    label: s.name,
    status: s.status,
    result: s.status === "done" ? s.value : undefined,
  })),
}));
```

### Relationship to Inspector

**No overlap.** Different layers, different audiences:

| Dimension | Inspector | Surface |
|-----------|-----------|---------|
| Audience | Developer / tests | End user of the app |
| When | Dev/test time | Production runtime |
| What it reads | Protocol internals (DIRTY, RESOLVED, signals, edges) | Domain-meaningful state (step names, progress, results) |
| Output | WeakMap metadata, signal arrays, Mermaid diagrams | Declarative UI descriptors (JSON) |
| Hot path? | No — `Inspector.enabled = false` in prod | Yes — user-facing presentation |
| Implementation | Static class with WeakMaps | `derived()` — a regular store in the graph |

Inspector = **x-ray vision into the callbag protocol** (devtools).
Surface = **what the end user should see** (product UI).

Inspector could provide a `Inspector.toSurface(store)` convenience that auto-generates a default descriptor from graph metadata — a "zero-config dev preview" bridge. But that's convenience, not the same thing.

### Architecture

```
┌─────────────────────────────────────────────────┐
│  User App                                        │
│                                                  │
│  pipeline / jobQueue / topic / agentLoop          │
│       │                                          │
│       ▼                                          │
│  surface(store, mapper)  ← derived() under hood  │
│       │                                          │
│       ▼                                          │
│  Store<SurfaceDescriptor>  (plain JSON)           │
│       │                                          │
│       ├──► React <Surface />                      │
│       ├──► Vue <Surface />                        │
│       ├──► Lit <cr-surface>                       │
│       ├──► toA2UI() adapter (future)              │
│       └──► toAgUI() adapter (future)              │
└─────────────────────────────────────────────────┘
```

### Where It Lives

- `surface()` primitive: **`src/patterns/surface.ts`** (Tier 4 — can import from orchestrate, messaging, data, utils)
- Renderers: **`src/compat/`** alongside existing framework bindings (React, Vue, Lit, Svelte)
- Protocol adapters (future): **`src/adapters/`** for `toA2UI()`, `toAgUI()`

### Descriptor Types (Starter Set)

Start with what orchestrate/messaging/AI naturally produce:

| Type | Source | What it shows |
|------|--------|---------------|
| `progress` | `pipeline`, `task` | Step list with status indicators, progress bar |
| `table` | `reactiveMap`, `collection` | Key-value or row data with sort/filter |
| `log` | `topic`, `reactiveLog`, `executionLog` | Scrolling event stream with timestamps |
| `form` | `approval`, `gate` | Input fields + submit for human-in-the-loop |
| `metric` | `StepMeta`, `tokenTracker` | Single number/gauge with label and trend |
| `chat` | `chatStream`, `agentLoop` | Message bubbles with streaming indicator |
| `diagram` | `toMermaid`/`toD2` output | Rendered graph visualization |

### Type Definitions (Draft)

```ts
interface SurfaceDescriptor {
  type: string;               // "progress" | "table" | "log" | "form" | "metric" | "chat" | "diagram" | string
  title?: string;
  children?: SurfaceDescriptor[];  // composition
  [key: string]: unknown;     // type-specific data
}

interface ProgressDescriptor extends SurfaceDescriptor {
  type: "progress";
  steps: Array<{
    label: string;
    status: "pending" | "running" | "done" | "error" | "paused" | "skipped";
    result?: unknown;
    error?: unknown;
    duration?: number;
  }>;
}

interface TableDescriptor extends SurfaceDescriptor {
  type: "table";
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, unknown>>;
}

interface LogDescriptor extends SurfaceDescriptor {
  type: "log";
  entries: Array<{
    timestamp: number;
    level?: "info" | "warn" | "error" | "debug";
    message: string;
    data?: unknown;
  }>;
  maxEntries?: number;
}

interface FormDescriptor extends SurfaceDescriptor {
  type: "form";
  fields: Array<{
    name: string;
    label: string;
    type: "text" | "number" | "select" | "checkbox";
    options?: string[];
    value?: unknown;
  }>;
  submitLabel?: string;
}

interface MetricDescriptor extends SurfaceDescriptor {
  type: "metric";
  label: string;
  value: number | string;
  unit?: string;
  trend?: "up" | "down" | "stable";
  sparkline?: number[];
}

interface ChatDescriptor extends SurfaceDescriptor {
  type: "chat";
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    streaming?: boolean;
  }>;
}

interface DiagramDescriptor extends SurfaceDescriptor {
  type: "diagram";
  format: "mermaid" | "d2";
  source: string;
}
```

### API Surface

```ts
// Core — ~20 lines, literally a derived() with type tag convention
function surface<T, D extends SurfaceDescriptor>(
  store: Store<T>,
  mapper: (value: T) => D,
  opts?: { name?: string }
): Store<D>;

// Auto-surface — derives default descriptor from known store types
// Uses Inspector metadata (store kind, name) to pick a sensible default
function autoSurface(store: Store<any>): Store<SurfaceDescriptor>;

// Composition — combine multiple surfaces into a dashboard
function dashboard(
  surfaces: Record<string, Store<SurfaceDescriptor>>,
  opts?: { layout?: "grid" | "stack" | "tabs" }
): Store<DashboardDescriptor>;
```

### Auto-Surface From Known Types

The killer feature for reducing friction: `autoSurface()` inspects a store's Inspector metadata and generates a sensible default descriptor:

```ts
const job = pipeline({ ... });
const ui = autoSurface(job);
// Automatically produces a ProgressDescriptor from pipeline status/steps

const queue = jobQueue({ ... });
const queueUI = autoSurface(queue);
// Automatically produces a MetricDescriptor + LogDescriptor composite

const chat = chatStream({ ... });
const chatUI = autoSurface(chat);
// Automatically produces a ChatDescriptor from messages
```

This is where Inspector metadata feeds into surface — not overlap, but collaboration.

### Renderers (~200 lines each)

Each renderer is a switch over `descriptor.type` that maps to native framework components:

```tsx
// React example
function Surface({ store }: { store: Store<SurfaceDescriptor> }) {
  const descriptor = useStore(store);
  switch (descriptor.type) {
    case "progress": return <ProgressView {...descriptor} />;
    case "table":    return <TableView {...descriptor} />;
    case "log":      return <LogView {...descriptor} />;
    case "form":     return <FormView {...descriptor} />;
    case "metric":   return <MetricView {...descriptor} />;
    case "chat":     return <ChatView {...descriptor} />;
    case "diagram":  return <DiagramView {...descriptor} />;
    default:         return <JsonView data={descriptor} />;
  }
}

// Users can override any type
<Surface store={ui} components={{ progress: MyCustomProgress }} />
```

### Escape Hatches

1. **Skip surface entirely** — subscribe to the raw store and build your own UI
2. **Override individual renderers** — pass `components` prop to `<Surface />`
3. **Custom descriptor types** — `type: "my-custom"` + register a renderer
4. **Raw access via `inner`** — surface store exposes `.inner` with the source store

---

## Rejected Alternatives

### Lock into A2UI
**Why not:** Spec v0.8, will break. Cross-platform trust-boundary protocol is overkill for JS devs who own their own frontend. Adding a `toA2UI()` adapter later is trivial.

### Lock into AG-UI
**Why not:** Transport protocol — callbag-recharge already IS a transport. Wrapping our stores in AG-UI events adds indirection without value.

### Build a full visual builder (heavy approach)
**Why not:** Against the library's philosophy. Recharge is composable primitives, not an IDE. Visual builders have high maintenance cost and opinionated assumptions about layout.

### Make surface a new primitive type (not derived)
**Why not:** Violates "prefer existing primitives" principle. A `derived()` with a convention is simpler, composes with everything, and carries zero new protocol cost.

### Put renderers in the core package
**Why not:** Framework-specific code doesn't belong in the core library. Renderers live in `compat/` alongside existing framework bindings, or as separate packages.

---

## Key Insight

Surface is "just another derived store." It fits the existing architecture with zero new concepts. The descriptor is plain JSON — renderable by any framework, serializable, testable with standard assertions. Users who want spontaneous UI get it via `autoSurface()`. Users who want traditional components ignore it and subscribe directly. Both paths are lightweight because neither adds a runtime.

The A2UI trend validates the pattern (declarative descriptors, client-owned rendering). But locking into an external protocol is premature. Own the descriptor shape, add protocol adapters when specs stabilize.

---

## Roadmap Placement

**Phase SU (Surface Layer)** — between SA (Standalone Products) and Phase 7.5 (Pre-Launch Positioning).

Rationale: Surface is a presentation layer over the standalone products. It needs SA-1 (orchestrate polish) and SA-3 (jobQueue) to have rich state to describe. But it's a powerful addition to the pre-launch story (7.5) — "see your orchestration results instantly."

Build order:
1. **SU-1:** `surface()` core + types + `autoSurface()` for pipeline (S)
2. **SU-2:** `autoSurface()` for jobQueue, topic, chatStream (S)
3. **SU-3:** `dashboard()` compositor (S)
4. **SU-4:** React renderer (M)
5. **SU-5:** Vue renderer — integrates into existing docs site (M)
6. **SU-6:** `toA2UI()` / `toAgUI()` adapters (S, when specs stabilize)

---

## Files Changed

None (design session only).
