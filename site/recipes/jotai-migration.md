---
outline: deep
---

# Migrating from Jotai

callbag-recharge ships a Jotai-compatible `atom()` function. You can migrate incrementally — atoms work alongside native callbag-recharge stores.

## Quick Comparison

| Feature | Jotai | callbag-recharge |
|---------|-------|-----------------|
| Primitive atom | `atom(0)` | `atom(0)` (compat) or `state(0)` (native) |
| Derived atom | `atom((get) => get(a) * 2)` | `atom((get) => get(a) * 2)` (compat) or `derived([a], () => a.get() * 2)` (native) |
| Writable derived | `atom(read, write)` | `atom(read, write)` (compat) |
| Dynamic deps | Built-in via `get()` | `dynamicDerived((get) => get(a))` |
| Diamond resolution | Glitches possible | Glitch-free (two-phase push) |
| Provider required | Yes (`<Provider>`) | No |
| Framework lock-in | React only | Framework-agnostic |
| Streaming operators | None | 60+ (switchMap, debounce, retry, ...) |
| Inspectable graph | Jotai DevTools | `Inspector.dumpGraph()` — runtime, no extension |

## Step 1: Use the Compat Layer (Zero Changes)

```diff
- import { atom } from 'jotai'
+ import { atom } from 'callbag-recharge/compat/jotai'
```

The compat `atom()` supports all three Jotai overloads:

```ts
import { atom } from 'callbag-recharge/compat/jotai'

// Primitive atom → wraps state()
const countAtom = atom(0)
countAtom.get()  // 0
countAtom.set(1)

// Derived atom → wraps dynamicDerived()
const doubledAtom = atom((get) => get(countAtom) * 2)
doubledAtom.get() // 2

// Writable derived atom
const clampedAtom = atom(
  (get) => get(countAtom),
  (get, set, value: number) => set(countAtom, Math.max(0, Math.min(100, value))),
)
clampedAtom.set(200)
countAtom.get() // 100
```

## Step 2: Replace React Hooks

Jotai's `useAtom` requires a React Provider. callbag-recharge atoms are standalone:

```diff
- import { useAtom } from 'jotai'
- const [count, setCount] = useAtom(countAtom)
+ const count = countAtom.get()
+ countAtom.set(newValue)
```

For React integration, use a minimal hook:

```ts
import { useState, useEffect } from 'react'

function useAtomValue<T>(atom: { get(): T; subscribe(cb: (v: T) => void): () => void }): T {
  const [value, setValue] = useState(atom.get())
  useEffect(() => atom.subscribe(setValue), [atom])
  return value
}

// Usage
function Counter() {
  const count = useAtomValue(countAtom)
  return <button onClick={() => countAtom.set(count + 1)}>{count}</button>
}
```

## Step 3: Migrate to Native API (Optional)

The compat layer is production-ready and zero-overhead. Migrating to native API unlocks streaming operators and explicit deps:

```diff
- import { atom } from 'callbag-recharge/compat/jotai'
+ import { state, derived } from 'callbag-recharge'

- const countAtom = atom(0)
+ const count = state(0)

- const doubledAtom = atom((get) => get(countAtom) * 2)
+ const doubled = derived([count], () => count.get() * 2)
```

### Why native?

- **Explicit deps** — `derived([a, b], fn)` declares dependencies upfront. No surprises from conditional `get()` calls
- **Streaming** — compose with `pipe`, `switchMap`, `debounce`, `retry`
- **Batching** — `batch(() => { a.set(1); b.set(2) })` for atomic multi-store updates
- **Inspector** — named stores visible in `Inspector.graph()`

## What You Gain

1. **No Provider** — atoms work anywhere, no React tree required
2. **Glitch-free diamonds** — Jotai can glitch when derived atoms form diamond patterns. callbag-recharge's two-phase push resolves diamonds correctly, every time
3. **Streaming operators** — `switchMap`, `debounce`, `throttle`, `scan`, `retry` — compose reactive pipelines
4. **Completion semantics** — atoms can complete/error; `retry` and `rescue` handle recovery
5. **Inspector** — `Inspector.dumpGraph()` shows every atom, its value, and dependency edges at runtime
