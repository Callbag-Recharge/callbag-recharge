---
outline: deep
---

# callbag-recharge vs RxJS

Both provide streaming operators. callbag-recharge adds first-class state (`.get()/.set()`), diamond resolution, and a simpler API.

## At a Glance

| Feature | RxJS | callbag-recharge |
|---------|------|-----------------|
| **State** | `BehaviorSubject` (awkward) | `state()` — first-class `.get()/.set()` |
| **Derived** | `combineLatest + map` | `derived([deps], fn)` — diamond-safe |
| **Operators** | 200+ | 70+ (covers common cases) |
| **Diamond resolution** | Not applicable | Glitch-free two-phase push |
| **Side effects** | `tap()`, manual | `effect([deps], fn)` — auto-tracks deps |
| **Bundle size** | ~30 KB (full) | ~4.5 KB core |
| **Tree-shaking** | Good (v7+) | Excellent (80+ entry points) |
| **State inspection** | None | `Inspector.dumpGraph()` |
| **Completion** | Full | Full |
| **Callbag interop** | Via adapter | Native |
| **Learning curve** | Steep | Moderate |

## The Key Difference

RxJS is a streaming library that awkwardly handles state. callbag-recharge is a state management library that natively handles streams.

```ts
// RxJS — state is a BehaviorSubject
const count$ = new BehaviorSubject(0)
count$.next(5)
count$.getValue() // 5 — getValue() is discouraged

// callbag-recharge — state is first-class
const count = state(0)
count.set(5)
count.get() // 5 — natural API
```

## Derived State: RxJS vs callbag-recharge

```ts
// RxJS — combineLatest + map, no diamond safety
const a$ = new BehaviorSubject(1)
const b$ = a$.pipe(rxMap(x => x * 2))
const c$ = a$.pipe(rxMap(x => x + 10))
const d$ = combineLatest([b$, c$]).pipe(rxMap(([b, c]) => b + c))
// When a$ emits, d$ may fire twice (once with stale b or c)

// callbag-recharge — diamond-safe
const a = state(1)
const b = derived([a], () => a.get() * 2)
const c = derived([a], () => a.get() + 10)
const d = derived([b, c], () => b.get() + c.get())
// When a.set(5), d computes exactly once: (10) + (15) = 25
```

## What RxJS Lacks

### 1. First-class state

`BehaviorSubject.getValue()` is officially discouraged. RxJS wants everything to be a stream, making simple state access verbose.

### 2. Diamond resolution

`combineLatest` can produce glitched intermediate values when multiple observables share an upstream source.

### 3. Graph inspection

No way to see the reactive graph at runtime. callbag-recharge's `Inspector` shows every node, edge, value, and status.

### 4. Simple API

RxJS has a steep learning curve with 200+ operators, hot/cold observables, Subject variants, and Scheduler concepts. callbag-recharge has 6 primitives and a flat operator set.

## What RxJS Does Better

- **More operators** — 200+ vs 70+ (though callbag-recharge covers all common patterns)
- **Mature ecosystem** — Angular integration, extensive community resources
- **Scheduler control** — fine-grained async scheduling
- **Hot/cold distinction** — explicit multicast control (callbag-recharge stores are inherently multicast)
- **RxJS interop** — if you're already deep in RxJS, `wrap()` bridges both directions

## Interop

callbag-recharge can interoperate with RxJS via `wrap()` and `fromObs()`:

```ts
import { fromObs, wrap } from 'callbag-recharge/extra'

// RxJS Observable → callbag-recharge store
const store = fromObs(rxjsObservable$)

// callbag-recharge store → RxJS Observable
const obs$ = wrap(store) // standard Observable
```

## When to Choose callbag-recharge

- You need both state management AND streaming in one library
- Diamond resolution correctness matters
- You want a simpler API than RxJS
- You want graph inspectability
- You're building a new project (no existing RxJS investment)
