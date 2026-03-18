---
outline: deep
---

# createStore: Zustand-Compatible API

A Zustand-style single-store pattern backed by callbag-recharge's reactive graph. Familiar API, but with diamond-safe derived selectors, automatic memoization, and full composability.

## Quick Example

<<< @/../examples/create-store.ts

## Why createStore?

| Feature | Zustand | callbag-recharge `createStore` |
|---------|---------|-------------------------------|
| Computed/derived | None built-in | `select()` — automatic, diamond-safe |
| Memoization | Manual `useShallow` | Push-phase, automatic via `equals` |
| Async actions | Native | Native |
| Framework lock-in | React hooks | None — framework-agnostic |
| Inspectable | DevTools extension | `Inspector.dumpGraph()` — runtime graph |
| Composable with streams | No | Full callbag-recharge interop |

## Selectors — The Killer Feature

Zustand has no built-in computed values. `createStore` does.

`select()` returns a reactive `Store<U>` that:
- Recomputes only when dependencies change (push-based, not poll-based)
- Is diamond-safe — no glitches in complex dependency graphs
- Uses `Object.is` memoization by default
- Is a full callbag-recharge `Store` — composable with `derived`, `effect`, `pipe`

```ts
const count = store.select(s => s.count)
const completedCount = store.select(s => s.todos.filter(t => t.done).length)

// Custom equality for array/object selectors
const todoTexts = store.select(
  s => s.todos.map(t => t.text),
  (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
)
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
- const count = useStore((s) => s.count)
+ const count = store.select((s) => s.count)
+ count.get()

  // Subscribing
- useStore.subscribe((state) => console.log(state))
+ store.subscribe((state, prev) => console.log(state))
```

## Replacing Zustand Middleware

### persist → `effect()` (2 lines)

```ts
import { effect } from 'callbag-recharge'

effect([store.store], () => {
  localStorage.setItem('my-store', JSON.stringify(store.getState()))
})
```

### devtools → `Inspector` (built-in)

```ts
import { Inspector } from 'callbag-recharge'

Inspector.dumpGraph()        // entire reactive graph
Inspector.trace(store.store, console.log) // value change callback
```

### subscribeWithSelector → `select()` (already built-in)

```ts
const count = store.select(s => s.count)
subscribe(count, (value) => console.log('count:', value))
```

## Full API Reference

See the [createStore README](https://github.com/Callbag-Recharge/callbag-recharge/blob/main/src/patterns/createStore/README.md) for the complete API, including `setState`, `getInitialState`, `destroy`, and composition with callbag-recharge primitives.
