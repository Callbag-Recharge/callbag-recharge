# dynamicDerived()

Like [`derived()`](/api/derived), but dependencies are discovered at runtime via a tracking `get` function. Deps can change between recomputations — upstream connections are rewired automatically.

Participates in diamond resolution (Tier 1). Same lazy lifecycle as `derived`: no computation until first subscriber or `.get()` call; disconnects from deps when the last subscriber leaves.

## Signature

```ts
function dynamicDerived<T>(fn: (get: TrackingGet) => T, opts?: DerivedOptions<T>): Store<T>
```

- `fn` receives a tracking `get(store)` function. Every store accessed via `get()` becomes a dependency for that recomputation.
- Dependencies are re-discovered on every recomputation. If `get(flag)` causes a branch that skips `get(b)`, `b` is not subscribed.

## Usage

```ts
import { state, dynamicDerived } from 'callbag-recharge'

const flag = state(true)
const a = state(1)
const b = state(2)

const result = dynamicDerived((get) => {
  return get(flag) ? get(a) : get(b)
})

result.get() // 1 — deps: [flag, a]
flag.set(false)
result.get() // 2 — deps rewired to [flag, b]; no longer subscribed to a
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `equals` | `(a, b) => boolean` | `Object.is` | Push-phase memoization. Sends `RESOLVED` instead of `DATA` if value is unchanged. |
| `name` | `string` | — | Debug name shown in Inspector. |

## vs `derived()`

| | `derived` | `dynamicDerived` |
|--|-----------|-----------------|
| Dep declaration | Explicit array `[dep1, dep2]` | Runtime via `get()` |
| Dep changes | Fixed at construction | Rewired on each recomputation |
| Use when | Deps are statically known | Deps depend on runtime values (e.g. conditional, lookup tables) |
| Overhead | None | Small per-recompute rewire check |

## Notes

- Re-entrancy guard (`D_RECOMPUTING` flag) prevents signal cycles during dep rewire.
- Stores not accessed in the latest `fn()` call are automatically unsubscribed.
- `derived.from(dep)` is the identity shorthand for single-dep forwarding — use `derived` or `dynamicDerived` for transform cases.
- Pull-computes from deps when `DISCONNECTED` (no subscribers). `get()` is always fresh.

## See also

- [`derived()`](/api/derived) — explicit-dep computed store
- [`effect()`](/api/effect) — side-effect runner with same dep model
- [Architecture §4 — Transform nodes](/architecture/)
