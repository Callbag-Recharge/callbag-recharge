# Extra Modules

callbag-recharge ships extra sources, operators, and sinks as tree-shakeable entry points under `callbag-recharge/extra` or `callbag-recharge/extra/<name>`.

## Current extras

### Sources

| Module | Description |
|--------|-------------|
| `interval(ms)` | Emits incrementing integers at a fixed interval |
| `fromEvent(target, name)` | Wraps DOM/EventEmitter events as a source |
| `fromPromise(promise)` | Converts a Promise into a single-value source |
| `fromObs(observable)` | Converts an Observable (RxJS-compatible) into a source |
| `fromIter(iterable)` | Converts a sync iterable into a source |

### Operators

| Module | Description |
|--------|-------------|
| `map(fn)` | Transforms each value |
| `filter(pred)` | Passes values matching a predicate |
| `scan(reducer, seed)` | Accumulates values with a reducer |
| `take(n)` | Emits only the first _n_ values, then completes |
| `skip(n)` | Skips the first _n_ values |
| `flat` | Flattens a source of sources (mergeAll semantics) |
| `merge(...sources)` | Merges multiple sources into one |
| `combine(...sources)` | Emits arrays of latest values when any source updates |
| `concat(...sources)` | Subscribes to sources sequentially |
| `share` | Shares a single upstream subscription across multiple sinks |
| `takeUntil(notifier)` | Passes through values until notifier emits, then completes and tears down upstream |
| `switchMap(fn)` | Maps to an inner store; unsubscribes from the previous inner on each outer change |
| `concatMap(fn)` | Maps to inner stores sequentially; queues outer values while inner is active |
| `exhaustMap(fn)` | Maps to an inner store; ignores new outer values while inner is active |
| `debounce(ms)` | Delays propagation by `ms` ms; resets timer on each new value |
| `throttle(ms)` | Leading-edge: passes first value, silences further values for `ms` ms |
| `distinctUntilChanged(eq?)` | Suppresses consecutive duplicate values; optional custom equality function |
| `startWith(value)` | Returns `value` when upstream is `undefined`; switches to upstream once it emits |
| `pairwise` | Emits `[prev, curr]` pairs on each upstream change |

### Sinks

| Module | Description |
|--------|-------------|
| `forEach(cb)` | Subscribes to a source, calling `cb` for each value |

---

## Roadmap

Candidates are prioritized by how well they stress-test correctness and memory-leak safety in the callbag graph.

### Tier 2 — Medium priority

Useful operators with moderate leak-testing value.

| Module | Category | Rationale |
|--------|----------|-----------|
| `delay(ms)` | Operator | Timer-based value deferral. Similar leak profile to debounce. |
| `buffer(notifier)` | Operator | Accumulates values into arrays. Tests verify buffers are released on unsubscribe. |
| `bufferTime(ms)` | Operator | Time-windowed buffering. Combines timer + accumulation leak risks. |
| `retry(n)` | Operator | Re-subscribes on error. Tests verify old subscriptions are cleaned up before retry. |
| `rescue(fn)` | Operator | Error recovery. Similar resubscription lifecycle to retry. |
| `sample(notifier)` | Operator | Dual-subscription lifecycle — tests verify both source and notifier are torn down. |
| `timeout(ms)` | Operator | Timer + error path. Tests catch leaked timers when source completes in time. |
| `subject` | Source | Multicast primitive. Tests verify all sinks are removed on completion/error. |
| `remember` | Operator | Like `share` but caches the last value. Tests verify cache is released on teardown. |
| `tap(fn)` | Operator | Side-effect passthrough. Also a useful testing utility. |

### Tier 3 — Nice to have

Simple modules whose tests validate callbag protocol compliance and early-termination cleanup.

| Module | Category | Rationale |
|--------|----------|-----------|
| `of(...values)` | Source | Synchronous multi-value source. Tests validate completion signaling. |
| `empty` | Source | Completes immediately. Tests validate END propagation with no DATA. |
| `throwError(err)` | Source | Errors immediately. Tests validate error-path teardown. |
| `never` | Source | Never emits or completes. Tests verify no leaks from idle sources. |
| `last` | Operator | Emits only the final value. Tests verify early-termination cleanup. |
| `first` | Operator | Emits only the first value then completes (like `take(1)` but semantic). |
| `find(pred)` | Operator | First value matching predicate, then completes. |
| `elementAt(n)` | Operator | Emits the _n_-th value then completes. |
| `partition(pred)` | Operator | Splits into two sources. Tests verify both branches clean up. |
| `repeat(n)` | Operator | Re-subscribes on completion. Tests verify previous-subscription disposal. |

---

## Testing strategy

Many of the original `callbag-*` repos (e.g., `callbag-take-until`, `callbag-debounce`, `callbag-switch-map`) have existing test suites that can be adapted to our vitest setup. Key patterns to test for each new module:

1. **Correctness** — values are emitted in the right order with the right timing
2. **Completion propagation** — END signals flow both upstream and downstream
3. **Teardown on unsubscribe** — sinks disconnecting mid-stream triggers cleanup (timers cleared, inner subs disposed, buffers released)
4. **No retained references** — after teardown, no closures hold references to values or sinks
