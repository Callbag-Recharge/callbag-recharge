---
outline: [2, 3]
---

# Getting Started

## Installation

```bash
npm i @callbag-recharge/callbag-recharge
```

## Your First State

`state()` creates a writable reactive store. Read with `get()`, write with `set()`, and update relative to the current value with `update()`.

```ts
import { state } from 'callbag-recharge'

const count = state(0)
count.get() // 0
count.set(5)
count.get() // 5
count.update(n => n + 1)
count.get() // 6
```

Every store is a callbag source under the hood, but you never need to think about the protocol -- the `Store` interface (`get()`, `set()`, `source()`) is all you use day to day.

## Derived Values

`derived()` creates a computed store that updates whenever its dependencies change. It takes an explicit deps array and a compute function.

```ts
import { state, derived } from 'callbag-recharge'

const count = state(0)
const doubled = derived([count], () => count.get() * 2)
doubled.get() // 0

count.set(5)
doubled.get() // 10
```

Key properties of `derived`:

- **Explicit deps array** -- you list exactly which stores the derived depends on. No implicit tracking magic.
- **Cached values** -- the compute function only re-runs when a dependency actually changes. `get()` always returns the cached value instantly.
- **Diamond-safe** -- when multiple deps share a common ancestor, the derived recomputes exactly once with all values consistent (see below).

## Multi-dep Derived (Diamond Resolution)

When a derived depends on multiple stores that share a common ancestor, callbag-recharge guarantees glitch-free updates. The derived waits for all dirty deps to resolve before recomputing.

```ts
const a = state(1)
const b = state(2)
const sum = derived([a, b], () => a.get() + b.get())

sum.get() // 3
a.set(10)
sum.get() // 12
```

In a diamond topology where `C` depends on both `A` and `B`, and `B` also depends on `A`, updating `A` causes `C` to recompute exactly once -- after both paths have resolved.

## Reacting to Changes with effect()

`effect()` runs a side-effect function whenever its dependencies change. It connects to deps at creation and runs inline (synchronously) when all deps settle.

```ts
import { state, derived, effect } from 'callbag-recharge'

const count = state(0)
const doubled = derived([count], () => count.get() * 2)

const dispose = effect([doubled], () => {
  console.log('doubled is now:', doubled.get())
  return () => { /* cleanup runs before next execution */ }
})

count.set(5)  // logs: "doubled is now: 10"
dispose()     // stops the effect, runs cleanup
```

The effect function can return a cleanup function. Cleanup runs before the next execution and when the effect is disposed.

## Subscribing to Value Changes

For push-based observation, use `subscribe()` from the extras. It provides the current value and the previous value on each change.

```ts
import { subscribe } from 'callbag-recharge/extra'

const unsub = subscribe(count, (value, prev) => {
  console.log(`${prev} → ${value}`)
})
unsub() // unsubscribe
```

## Composing with pipe()

`pipe()` chains operators together. Each step (`map`, `filter`, `scan`) creates a new `Store` -- fully inspectable and subscribable.

```ts
import { state, pipe } from 'callbag-recharge'
import { map, filter, scan } from 'callbag-recharge/extra'

const count = state(0)
const result = pipe(
  count,
  map(n => n * 2),
  filter(n => n > 0),
  scan((acc, n) => acc + n, 0),
)
// Each step is an inspectable store
result.get()
```

For maximum throughput, `pipeRaw()` fuses all transform functions into a single `derived()` store, eliminating intermediate nodes:

```ts
import { pipeRaw, SKIP } from 'callbag-recharge/extra'
```

## Async Sources with producer()

`producer()` is the general-purpose source primitive. It is lazy -- the start function runs on the first subscriber and the cleanup function runs when the last subscriber disconnects.

```ts
import { producer } from 'callbag-recharge'

const ticks = producer<number>(({ emit }) => {
  const id = setInterval(() => emit(Date.now()), 1000)
  return () => clearInterval(id)
})
// Lazy: starts on first subscriber, stops when all unsubscribe
```

Producer supports options like `initial` (baseline value), `equals` (emission guard), `resetOnTeardown`, and `resubscribable` (allow re-subscription after completion or error).

## Batching Updates

`batch()` groups multiple state changes so that derived stores and effects recompute only once, after all changes are applied.

```ts
import { state, derived, batch } from 'callbag-recharge'

const a = state(1)
const b = state(2)
const sum = derived([a, b], () => a.get() + b.get())

batch(() => {
  a.set(10)
  b.set(20)
})
// sum recomputes once (not twice), seeing both changes
```

During a batch, DIRTY signals propagate immediately (so the graph knows what is stale), but DATA emission is deferred until the outermost batch exits. This means diamond resolution works correctly even across batched changes.

## Inspecting the Graph

Every store can be registered with `Inspector` for runtime observability. Pass a `name` option when creating stores to make them identifiable.

```ts
import { state, Inspector } from 'callbag-recharge'

const count = state(0, { name: 'count' })
Inspector.inspect(count)
// { name: 'count', kind: 'state', value: 0, status: 'SETTLED' }

Inspector.graph()
// Map { 'count' => { name: 'count', kind: 'state', ... } }
```

Inspector also supports signal hooks (`onEmit`, `onSignal`, `onStatus`, `onEnd`) and dependency edge tracking via `registerEdge()` -- useful for building devtools and debugging reactive graphs.

## Next Steps

- [Extras Reference](/extras/) -- 70+ tree-shakeable operators, sources, and sinks
- [Architecture](/architecture/) -- deep dive into the two-phase push protocol, output slot model, and diamond resolution
