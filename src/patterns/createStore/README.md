# createStore — Single-Store State Management

A Zustand-style single-store pattern backed by callbag-recharge's reactive graph. Familiar API, but with diamond-safe derived selectors, automatic memoization, and full composability with reactive primitives.

## Why createStore?

| Feature | Zustand | Redux Toolkit | callbag-recharge `createStore` |
|---------|---------|---------------|-------------------------------|
| Bundle size | ~1KB | ~11KB | ~0.5KB (tree-shaken) |
| Computed/derived | None built-in | reselect (manual) | `select()` — automatic, diamond-safe |
| Memoization | Manual `useShallow` | Manual `createSelector` | Push-phase, automatic via `equals` |
| Async actions | Native | Thunks/sagas | Native |
| Middleware compat | Yes (StoreApi) | Yes | Yes (matches Zustand StoreApi) |
| Framework lock-in | React hooks | React + redux | None — framework-agnostic |
| Inspectable | DevTools extension | DevTools extension | `Inspector.dumpGraph()` — runtime graph |
| Composable with streams | No | No | Full callbag-recharge interop |

## Quick Start

```ts
import { createStore } from 'callbag-recharge/patterns/createStore'

const store = createStore((set, get) => ({
  // State
  count: 0,
  name: 'Alice',
  todos: [] as { text: string; done: boolean }[],

  // Actions — just functions that call set()
  increment: () => set(s => ({ count: s.count + 1 })),
  decrement: () => set(s => ({ count: s.count - 1 })),
  setName: (name: string) => set({ name }),

  addTodo: (text: string) =>
    set(s => ({ todos: [...s.todos, { text, done: false }] })),

  toggleTodo: (index: number) =>
    set(s => ({
      todos: s.todos.map((t, i) =>
        i === index ? { ...t, done: !t.done } : t
      ),
    })),
}))
```

## Reading State

```ts
// Full state object
store.getState()
// → { count: 0, name: 'Alice', todos: [], increment: fn, ... }

// Individual values
store.getState().count  // 0
store.getState().name   // 'Alice'
```

## Calling Actions

Actions are part of the state object. Call them directly:

```ts
store.getState().increment()
store.getState().addTodo('Buy milk')
store.getState().toggleTodo(0)
```

## Updating State Directly

Use `setState` for direct updates without going through an action:

```ts
// Shallow merge (default)
store.setState({ count: 10 })
// → { count: 10, name: 'Alice', ... }  (other fields preserved)

// Updater function
store.setState(s => ({ count: s.count + 5 }))

// Full replace
store.setState({ count: 0, name: 'Bob', todos: [] }, true)
```

## Subscribing to Changes

```ts
const unsub = store.subscribe((state, prevState) => {
  console.log('count changed:', prevState.count, '→', state.count)
})

// Later: stop listening
unsub()
```

## Selectors — The Killer Feature

Zustand has no built-in computed/derived values. `createStore` does.

`select()` returns a reactive `Store<U>` that:
- Recomputes only when dependencies change (push-based, not poll-based)
- Is diamond-safe — no glitches in complex dependency graphs
- Uses `Object.is` memoization by default — skips recompute when value hasn't changed
- Is a full callbag-recharge `Store` — composable with `derived`, `effect`, `pipe`

```ts
// Simple selector — extracts a single value
const count = store.select(s => s.count)
count.get()  // 0

// Computed selector — derived value
const completedCount = store.select(
  s => s.todos.filter(t => t.done).length
)
completedCount.get()  // 0

// Complex derived computation
const summary = store.select(s => ({
  total: s.todos.length,
  done: s.todos.filter(t => t.done).length,
  remaining: s.todos.filter(t => !t.done).length,
}))

// Custom equality — for object/array selectors
const todoTexts = store.select(
  s => s.todos.map(t => t.text),
  (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
)
```

### Why selectors matter

In Zustand, "selectors" are just functions re-evaluated on every render. There's no dependency graph, no memoization, no diamond resolution. You need `useShallow`, `createSelector`, or manual `useMemo` to avoid unnecessary work.

In callbag-recharge, `select()` returns a `Store` backed by `derived()` — the same primitive that powers the entire reactive graph. When `store.setState({ name: 'Bob' })` fires, a selector watching only `count` doesn't recompute at all (push-phase memoization via `Object.is`).

## Async Actions

Async actions work naturally — no thunk middleware needed:

```ts
const store = createStore((set, get) => ({
  data: null as Data | null,
  loading: false,
  error: null as string | null,

  fetchData: async (id: string) => {
    set({ loading: true, error: null })
    try {
      const res = await fetch(`/api/data/${id}`)
      const data = await res.json()
      set({ data, loading: false })
    } catch (e) {
      set({ error: (e as Error).message, loading: false })
    }
  },
}))

await store.getState().fetchData('123')
```

## Batching Multiple Updates

When multiple `setState` calls happen synchronously, use `batch()` to coalesce them into a single notification:

```ts
import { batch } from 'callbag-recharge/patterns/createStore'

batch(() => {
  store.setState({ count: 10 })
  store.setState({ name: 'Bob' })
})
// Subscribers fire once with final state
```

## Composing with callbag-recharge Primitives

`store.store` exposes the underlying `WritableStore<T>`, so you can use the full callbag-recharge toolkit:

```ts
import { derived, effect } from 'callbag-recharge'

// Derived store across multiple createStore instances
const userStore = createStore((set) => ({
  name: 'Alice',
  setName: (name: string) => set({ name }),
}))

const settingsStore = createStore((set) => ({
  theme: 'dark' as 'light' | 'dark',
  toggleTheme: () =>
    set(s => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
}))

// Cross-store derived value — diamond-safe
const greeting = derived(
  [userStore.store, settingsStore.store],
  () => {
    const user = userStore.getState()
    const settings = settingsStore.getState()
    return `Hello ${user.name}! Theme: ${settings.theme}`
  }
)

greeting.get()  // "Hello Alice! Theme: dark"

// Side effects
const dispose = effect([userStore.store], () => {
  console.log('User changed:', userStore.getState().name)
})

// Cleanup
dispose()
```

## Zustand Middleware Compatibility

`createStore` matches Zustand's `StoreApi<T>` interface:

```ts
interface StoreApi<T> {
  setState: (partial, replace?) => void
  getState: () => T
  getInitialState: () => T
  subscribe: (listener) => () => void
}
```

This means Zustand middleware that wraps `StoreApi` (persist, devtools, immer) can be adapted to work with callbag-recharge stores.

## Inspecting the Store Graph

Every `select()` call creates a `derived()` node visible to the Inspector:

```ts
import { Inspector } from 'callbag-recharge'

const store = createStore(() => ({ count: 0, name: 'Alice' }))
const count = store.select(s => s.count)
const doubled = store.select(s => s.count * 2)

Inspector.dumpGraph()
// Store Graph (3 nodes):
//   createStore (state) = { count: 0, name: 'Alice' }  [SETTLED]
//   derived (derived) = 0  [SETTLED]
//   derived (derived) = 0  [SETTLED]
//   Edges: createStore → derived, createStore → derived
```

## API Reference

### `createStore(initializer)`

Creates a store from an initializer function.

```ts
function createStore<T extends object>(
  initializer: (set: Set<T>, get: Get<T>) => T
): CreateStoreResult<T>
```

**Parameters:**
- `initializer(set, get)` — Function that returns the initial state object. Receives:
  - `set(partial, replace?)` — Update state. `partial` can be an object (shallow merged) or an updater function `(state) => partial`. Pass `replace: true` to replace the entire state.
  - `get()` — Read the current state.

**Returns:** `CreateStoreResult<T>` with:

| Method | Description |
|--------|-------------|
| `getState()` | Returns the current full state object |
| `setState(partial, replace?)` | Update state (shallow merge or replace) |
| `getInitialState()` | Returns the original state from initialization |
| `subscribe(listener)` | Listen to state changes. Returns unsubscribe function |
| `select(selector, equals?)` | Create a derived `Store<U>` from a selector function |
| `store` | The underlying `WritableStore<T>` for composition |
| `destroy()` | Disconnect internal subscriptions |

### `batch(fn)`

Re-exported from core. Coalesces state updates within `fn` into a single notification cycle.

```ts
function batch<T>(fn: () => T): T
```

## Migration from Zustand

```diff
- import { create } from 'zustand'
+ import { createStore } from 'callbag-recharge/patterns/createStore'

- const useStore = create((set) => ({
+ const store = createStore((set) => ({
    count: 0,
    increment: () => set((s) => ({ count: s.count + 1 })),
  }))

  // Reading state
- const count = useStore((s) => s.count)           // React hook
+ const count = store.select((s) => s.count)        // Reactive Store
+ count.get()                                        // Read value

  // Calling actions
- useStore.getState().increment()
+ store.getState().increment()

  // Subscribing
- useStore.subscribe((state) => console.log(state))
+ store.subscribe((state, prev) => console.log(state))
```

### What you gain by switching

1. **Built-in computed values** — `select()` returns a memoized, diamond-safe reactive store. No `useShallow`, no `createSelector`, no `useMemo`.
2. **Framework-agnostic** — Works in Node.js, Deno, the browser, anywhere. No React dependency.
3. **Full reactive graph** — Compose with `derived()`, `effect()`, `pipe()`, and 40+ operators from `callbag-recharge/extra`.
4. **Inspectable** — `Inspector.dumpGraph()` shows every node, value, and dependency edge at runtime.
5. **Streaming** — Connect WebSocket, Kafka, or any async source into the same graph via `producer()`.
