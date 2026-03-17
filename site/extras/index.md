---
outline: [2, 3]
---

# Extras Reference

callbag-recharge ships 60+ tree-shakeable operators as extras.

## Import

```ts
// Import from the barrel
import { map, filter, scan } from 'callbag-recharge/extra'

// Or import individually for maximum tree-shaking
import { switchMap } from 'callbag-recharge/extra/switchMap'
```

## Sources

| Module | Description |
|--------|-------------|
| `interval(ms)` | Emits incrementing integers at a fixed interval |
| `fromEvent(target, name)` | Wraps DOM/EventEmitter events as a source |
| `fromPromise(promise)` | Converts a Promise into a single-value source |
| `fromObs(observable)` | Converts an Observable (RxJS-compatible) into a source |
| `fromIter(iterable)` | Converts a sync iterable into a source |
| `fromAsyncIter(iterableOrFactory)` | Converts an AsyncIterable into a source; factory form `() => AsyncIterable` supports retry/repeat |
| `of(...values)` | Synchronously emits each provided value, then completes |
| `empty()` | Completes immediately without emitting any values |
| `throwError(err)` | Errors immediately with the given value |
| `never()` | Never emits, errors, or completes |

## Tier 1 Operators

*Participate in diamond resolution, forward type 3.*

| Module | Description |
|--------|-------------|
| `map(fn)` | Transforms each value |
| `filter(pred)` | Passes values matching a predicate; sends RESOLVED when suppressing |
| `scan(reducer, seed)` | Accumulates values with a reducer |
| `take(n)` | Emits only the first _n_ values, then disconnects + completes |
| `first` | Emits only the first value then completes (like `take(1)` but semantic) |
| `last` | Emits only the final value when upstream completes |
| `find(pred)` | First value matching predicate, then completes |
| `elementAt(n)` | Emits the _n_-th value (0-based) then completes |
| `partition(pred)` | Splits into two stores `[matching, notMatching]`; shares upstream |
| `skip(n)` | Skips the first _n_ values; sends RESOLVED when suppressing |
| `tap(fn)` | Side-effect passthrough; forwards all signals and values unchanged |
| `distinctUntilChanged(eq?)` | Suppresses consecutive duplicates; sends RESOLVED on duplicate |
| `pairwise` | Emits `[prev, curr]` pairs on each upstream change |
| `startWith(value)` | Returns `value` when upstream is `undefined`; switches to upstream once it emits |
| `takeUntil(notifier)` | Passes through values until notifier emits, then completes and tears down upstream |
| `remember` | Caches the last upstream value and replays it to new subscribers |
| `merge(...sources)` | Merges multiple sources into one |
| `combine(...sources)` | Emits arrays of latest values when any source updates |
| `concat(...sources)` | Subscribes to sources sequentially |
| `flat` | Flattens a source of sources (mergeAll semantics) |
| `share` | Shares a single upstream subscription across multiple sinks |
| `buffer(notifier)` | Accumulates values into arrays; flushes on notifier emission |
| `withLatestFrom(...others, fn)` | When source emits, grabs current values from others; primary+secondary dep pattern |
| `subject` | Multicast primitive; both a source and manual emitter |

## Tier 2 Operators

*Cycle boundaries, built on `producer()`.*

| Module | Description |
|--------|-------------|
| `debounce(ms)` | Delays propagation by `ms` ms; resets timer on each new value |
| `throttle(ms)` | Leading-edge: passes first value, silences further values for `ms` ms |
| `delay(ms)` | Delays each value by `ms` ms; resets to undefined on teardown |
| `bufferTime(ms)` | Time-windowed buffering; flushes accumulated arrays at fixed intervals |
| `timeout(ms)` | Errors if no value arrives within `ms` ms |
| `sample(notifier)` | Emits the latest value when notifier fires |
| `switchMap(fn)` | Maps to an inner store; unsubscribes from the previous inner on each outer change |
| `concatMap(fn)` | Maps to inner stores sequentially; queues outer values while inner is active |
| `exhaustMap(fn)` | Maps to an inner store; ignores new outer values while inner is active |
| `rescue(fn)` | On error, switches to a fallback store |
| `retry(n)` | Re-subscribes on error up to n times |
| `repeat(factory, n?)` | Re-subscribes via factory on completion, up to n total times |
| `audit(ms)` | Trailing-edge throttle; emits latest value after `ms` ms silence window |
| `bufferCount(count, startEvery?)` | Count-based buffering; tumbling (default) or sliding window |
| `reduce(fn, seed)` | Collects finite source into a single result via reducer; emits on completion |
| `toArray()` | Collects finite source values into an array; emits on completion |
| `groupBy(keyFn)` | Routes values into sub-stores by key; output is `Map<K, Store<V>>` |
| `race(...sources)` | Emits from whichever source fires first; unsubscribes others |
| `window(notifier)` | Splits values into nested window stores; new window on notifier emission |
| `windowCount(count)` | Splits values into nested window stores of `count` values each |
| `windowTime(ms)` | Splits values into nested window stores that last `ms` milliseconds each |

## Piping

| Module | Description |
|--------|-------------|
| `pipeRaw(source, ...fns)` | Fuses transform functions into a single `derived()` store for ~2x throughput |
| `SKIP` | Sentinel for filter semantics in `pipeRaw` -- returning `SKIP` keeps the cached value |

## Sinks

| Module | Description |
|--------|-------------|
| `subscribe(store, cb)` | Listens to value changes with previous-value tracking; pure callbag sink |
| `forEach(cb)` | Subscribes to a source, calling `cb` for each value |

## Interop

| Module | Description |
|--------|-------------|
| `wrap(rawSource)` | Promotes a raw callbag source to a tier 2 Store (producer-based, autoDirty) |
| `wrap(input, rawOp)` | Promotes a raw callbag map-like operator to a tier 1 Store (STATE bypass for diamond resolution) |

**Constraint:** `wrap(input, rawOp)` is synchronous map-only. Filtering or tier 2 raw operators must use `operator()` directly with explicit signal handling.
