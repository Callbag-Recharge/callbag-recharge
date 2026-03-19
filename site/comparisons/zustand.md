---
outline: deep
---

# callbag-recharge vs Zustand

Both are simple, ergonomic state management libraries. callbag-recharge adds diamond resolution, streaming operators, and graph inspectability while keeping the same API shape.

## At a Glance

| Feature | Zustand | callbag-recharge |
|---------|---------|-----------------|
| **API style** | `create((set, get) => state)` | Same via `createStore()` pattern |
| **Computed values** | None built-in | `select()` — automatic, diamond-safe |
| **Memoization** | Manual (`useShallow`) | Automatic push-phase via `equals` |
| **Diamond resolution** | Not applicable (no derived) | Glitch-free two-phase push |
| **Streaming operators** | None | 60+ (switchMap, debounce, retry, ...) |
| **Framework** | React-first (vanilla adapter) | Framework-agnostic |
| **DevTools** | Browser extension | `Inspector.dumpGraph()` — runtime, programmatic |
| **Bundle size** | ~1.1 KB | ~4.5 KB core (tree-shakeable) |
| **Middleware** | persist, devtools, immer | `effect()`, `Inspector`, native immutability |
| **Completion/Error** | None | Full stream lifecycle |
| **TypeScript** | Good | Full inference |

## Migration Path

callbag-recharge ships a Zustand-compatible `createStore()` and a drop-in `compat/zustand` layer.

### Option 1: `createStore` pattern (recommended)

```ts
// Zustand
import { create } from 'zustand'
const useStore = create((set) => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
}))

// callbag-recharge — same shape, adds select()
import { createStore } from 'callbag-recharge/patterns/createStore'
const store = createStore((set) => ({
  count: 0,
  increment: () => set((s) => ({ count: s.count + 1 })),
}))

// Zustand doesn't have this:
const count = store.select(s => s.count) // diamond-safe derived store
```

### Option 2: Drop-in compat

```diff
- import { create } from 'zustand'
+ import { create } from 'callbag-recharge/compat/zustand'
```

## What Zustand Lacks

### 1. Computed values / Selectors as stores

Zustand has no built-in computed. You either use `useStore(selector)` (re-renders on every state change, then checks equality) or `useShallow` (manual).

callbag-recharge's `select()` returns a reactive `Store<T>` that recomputes only when its dependencies change — push-based, not poll-based.

### 2. Diamond resolution

When multiple selectors share upstream data, Zustand can produce inconsistent intermediate states. callbag-recharge's two-phase push ensures every derived value is correct.

### 3. Streaming operators

Need debounce, switchMap, retry, bufferTime? Zustand requires a separate library (RxJS). callbag-recharge has 60+ composable operators.

### 4. Programmatic inspection

Zustand DevTools is a browser extension. callbag-recharge's `Inspector` is programmatic — use it in tests, CLI tools, server-side monitoring, or logging.

## What Zustand Does Better

- **Smaller bundle** — ~1.1 KB vs ~4.5 KB core
- **React integration** — first-class hooks, no wrapper needed
- **Ecosystem** — larger community, more middleware, more examples
- **Simplicity** — if you only need atoms, Zustand is simpler

## When to Choose callbag-recharge

- You need computed/derived values that are always consistent
- You need streaming operators (debounce, switchMap, retry)
- You need to work outside React (Node.js, edge, multi-framework)
- You need graph inspectability for debugging or monitoring
- You're building an agentic workflow or data pipeline alongside UI state
