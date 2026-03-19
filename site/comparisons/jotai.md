---
outline: deep
---

# callbag-recharge vs Jotai

Both use atomic state with derived computations. callbag-recharge adds glitch-free diamond resolution, streaming operators, and works without React.

## At a Glance

| Feature | Jotai | callbag-recharge |
|---------|-------|-----------------|
| **Primitive atom** | `atom(0)` | `state(0)` or `atom(0)` via compat |
| **Derived atom** | `atom((get) => ...)` | `derived([deps], fn)` or `dynamicDerived(fn)` |
| **Dep tracking** | Implicit via `get()` | Explicit or dynamic (your choice) |
| **Diamond resolution** | Glitches possible | Glitch-free (two-phase push) |
| **Provider** | Required (`<Provider>`) | None |
| **Framework** | React only | Framework-agnostic |
| **Streaming operators** | None | 60+ (switchMap, debounce, retry, ...) |
| **Async atoms** | `atom(async (get) => ...)` | `producer()` + `switchMap` |
| **DevTools** | Jotai DevTools extension | `Inspector.dumpGraph()` |
| **Bundle size** | ~2.4 KB | ~4.5 KB core (tree-shakeable) |
| **Completion/Error** | None (atoms are infinite) | Full stream lifecycle |
| **Write atoms** | `atom(read, write)` | `atom(read, write)` via compat |

## The Diamond Problem

Jotai can produce inconsistent intermediate states when derived atoms form diamond patterns:

```
     A
    / \
   B   C
    \ /
     D
```

When A updates, Jotai may compute D while B is updated but C is not yet — producing a glitched value. callbag-recharge's two-phase push sends DIRTY through the entire graph first, then values flow only when all dependencies are resolved.

## Migration Path

### Drop-in compat

```diff
- import { atom } from 'jotai'
+ import { atom } from 'callbag-recharge/compat/jotai'
```

All three overloads work: `atom(initial)`, `atom(read)`, `atom(read, write)`.

### Native API (explicit deps)

```ts
// Jotai — implicit dep tracking
const doubled = atom((get) => get(countAtom) * 2)

// callbag-recharge — explicit deps (preferred)
const doubled = derived([count], () => count.get() * 2)

// callbag-recharge — dynamic deps (like Jotai)
const result = dynamicDerived((get) => get(flag) ? get(a) : get(b))
```

## What Jotai Lacks

### 1. Diamond resolution

See above. callbag-recharge guarantees derived stores compute exactly once per upstream change with consistent values.

### 2. Streaming operators

Jotai has no built-in way to debounce, throttle, buffer, or retry. callbag-recharge has 60+ operators that compose with `pipe()`.

### 3. Framework independence

Jotai requires React and a Provider. callbag-recharge works in Node.js, edge runtimes, browser without React, or any framework.

### 4. Completion semantics

Jotai atoms are infinite. callbag-recharge stores can complete and error — enabling `retry`, `rescue`, `repeat` for resilient data flows.

## What Jotai Does Better

- **Simpler mental model** — implicit `get()` tracking is easier to learn
- **React integration** — `useAtom` hook with Suspense support
- **Ecosystem** — jotai-immer, jotai-optics, jotai-tanstack-query
- **Async atoms** — first-class `async` support with Suspense

## When to Choose callbag-recharge

- Diamond resolution correctness matters (financial, real-time, multi-source)
- You need streaming operators (debounce, switchMap, retry)
- You need to work outside React
- You want a unified state + streaming library (not atoms + RxJS)
- You're building pipelines, workflows, or agentic systems
