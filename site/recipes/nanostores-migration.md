---
outline: deep
---

# Migrating from Nanostores

callbag-recharge ships a Nanostores-compatible API with `atom()`, `computed()`, and `map()`. If you're in the Astro/multi-framework ecosystem, this is a drop-in replacement that adds diamond resolution, streaming operators, and graph inspectability.

## Quick Comparison

| Feature | Nanostores | callbag-recharge |
|---------|-----------|-----------------|
| Atom | `atom(0)` | `atom(0)` (compat) or `state(0)` (native) |
| Computed | `computed(a, fn)` | `computed(a, fn)` (compat) or `derived([a], fn)` (native) |
| Map | `map({ ... })` | `map({ ... })` (compat) |
| `.subscribe()` | Immediate call + listen | Same behavior |
| `.listen()` | Changes only | Same behavior |
| Diamond resolution | Glitches | Glitch-free (two-phase push) |
| Streaming operators | None | 70+ (switchMap, debounce, retry, ...) |
| Inspectable graph | No | `Inspector.dumpGraph()` |
| Framework support | Astro, React, Vue, Svelte | Any (framework-agnostic) |

## Step 1: Use the Compat Layer (Zero Changes)

```diff
- import { atom, computed, map } from 'nanostores'
+ import { atom, computed, map } from 'callbag-recharge/compat/nanostores'
```

All three Nanostores primitives are supported with identical API:

```ts
import { atom, computed, map } from 'callbag-recharge/compat/nanostores'

// atom — wraps state()
const count = atom(0)
count.get()  // 0
count.set(1)

// subscribe — immediate call with current value
count.subscribe(v => console.log(v)) // logs 1 immediately

// listen — changes only (no immediate call)
count.listen(v => console.log('changed:', v))
count.set(2) // logs "changed: 2"

// computed — wraps derived() with Object.is memoization
const doubled = computed(count, v => v * 2)
doubled.get() // 4

// Multi-store computed
const a = atom(1)
const b = atom(2)
const sum = computed([a, b], (aVal, bVal) => aVal + bVal)
sum.get() // 3

// map — object store with setKey
const profile = map({ name: 'Alice', age: 30 })
profile.setKey('age', 31)
profile.get() // { name: 'Alice', age: 31 }
```

## Step 2: Migrate to Native API (Optional)

The compat layer is production-ready. Migrating to native API unlocks streaming, batching, and full graph composability:

```diff
- import { atom, computed } from 'callbag-recharge/compat/nanostores'
+ import { state, derived } from 'callbag-recharge'
+ import { subscribe } from 'callbag-recharge/extra'

- const count = atom(0)
+ const count = state(0)

- const doubled = computed(count, v => v * 2)
+ const doubled = derived([count], () => count.get() * 2)

- count.subscribe(v => console.log(v))
+ subscribe(count, v => console.log(v))
```

### Key differences in native API

| Nanostores compat | Native callbag-recharge | Notes |
|---|---|---|
| `atom.subscribe(cb)` | `subscribe(store, cb)` | Native `subscribe` does not call immediately |
| `atom.listen(cb)` | `subscribe(store, cb)` | Same behavior (changes only) |
| `computed(stores, fn)` | `derived([stores], fn)` | Native uses `fn()` that calls `.get()` inside |
| `map(obj).setKey(k, v)` | `state(obj).update(o => ({...o, [k]: v}))` | Or use `reactiveMap` for per-key reactivity |

## Step 3: Use `reactiveMap` for Per-Key Reactivity

Nanostores' `map()` re-renders all subscribers on any key change. callbag-recharge's `reactiveMap` provides per-key reactivity:

```ts
import { reactiveMap } from 'callbag-recharge/data'

const profile = reactiveMap<string, unknown>()
profile.set('name', 'Alice')
profile.set('age', 30)

// Only triggers when 'name' changes — not when 'age' changes
const name = profile.select('name')
subscribe(name, v => console.log('name:', v))
```

## What You Gain

1. **Diamond resolution** — Nanostores' `computed` glitches when multiple paths converge. callbag-recharge resolves diamonds correctly via two-phase push
2. **Streaming operators** — `switchMap`, `debounce`, `throttle`, `scan`, `retry` — compose reactive data pipelines
3. **Completion and error semantics** — stores can complete/error; `retry` and `rescue` handle recovery
4. **Batching** — `batch(() => { a.set(1); b.set(2) })` — derived stores recompute once, not twice
5. **Inspector** — `Inspector.dumpGraph()` shows the full reactive graph at runtime
6. **Per-key reactivity** — `reactiveMap` provides O(1) per-key subscriptions (1.56x native Map performance)
