# Usage Examples Plan

Three tiers of coverage for all public API functions.

---

## Tier 1 — JSDoc `@example` in source files

Add TSDoc `@example` blocks directly on each exported function. These appear in IDE hover tooltips and are picked up by doc generators.

**Files to update:**

| File | Functions |
|------|-----------|
| `src/state.ts` | `state(initial, options?)` |
| `src/derived.ts` | `derived(deps, fn, options?)` |
| `src/producer.ts` | `producer(fn?, opts?)` |
| `src/operator.ts` | `operator(deps, init, opts?)` |
| `src/effect.ts` | `effect(deps, fn)` |
| `src/subscribe.ts` | `subscribe(store, cb)` |
| `src/pipe.ts` | `pipe()`, `pipeRaw()`, `SKIP` |
| `src/protocol.ts` | `batch()` |
| `src/inspector.ts` | `Inspector` (class-level doc) |

**Example shape** (keep examples short — 5–10 lines):

```ts
/**
 * Creates a writable store holding a single value.
 *
 * @example
 * ```ts
 * const count = state(0);
 * count.get();      // 0
 * count.set(1);
 * count.get();      // 1
 * ```
 */
export function state<T>(initial: T, options?: StateOptions<T>): WritableStore<T>
```

**Conventions:**
- One `@example` per function (add a second only for meaningfully different usage, e.g. `equals` option)
- Show the return value in a comment, not `console.log`
- Show teardown / dispose where relevant (effect, subscribe)

---

## Tier 2 — `examples/` directory (runnable files)

Longer, multi-primitive examples that show realistic patterns. Each file is a standalone `.ts` script that can be run with `tsx examples/<name>.ts`.

**Files to create:**

| File | Demonstrates |
|------|-------------|
| `examples/counter.ts` | `state` + `derived` + `effect` — basic reactive counter |
| `examples/diamond.ts` | Diamond dependency graph — shows single-fire effect guarantee |
| `examples/batch.ts` | `batch()` — multiple `set()` calls coalesced into one effect run |
| `examples/producer-push.ts` | `producer` push source + `subscribe` — e.g. simulated WebSocket |
| `examples/producer-actions.ts` | `producer` with init function — lifecycle, emit, complete, error |
| `examples/pipe-operators.ts` | `pipe()` with `map`, `filter`, `scan` — transformation chain |
| `examples/pipe-raw.ts` | `pipeRaw()` with `SKIP` — high-throughput fused pipeline |
| `examples/extras.ts` | `interval`, `fromEvent`, `merge`, `share`, `forEach` — core extras wired together |
| `examples/extras-operators.ts` | `switchMap`, `debounce`, `distinctUntilChanged`, `takeUntil`, `pairwise` — stateful operator patterns |
| `examples/inspector.ts` | `Inspector.graph()`, `Inspector.enabled` — debug tooling |

**Conventions:**
- Each file is self-contained: imports only from `callbag-recharge` or Node built-ins
- Dispose / clean up at the end so the script exits cleanly
- A short comment block at the top explains what pattern the file demonstrates

---

## Tier 3 — README quick-start section

A concise section near the top of `README.md` showing the 4–5 most important functions. Links to the full API docs for details.

**Structure:**

```
## Quick start

### State & derived
<short snippet: state + derived + effect>

### Streams
<short snippet: stream + subscribe>

### Pipe
<short snippet: pipe with map/filter>

→ Full API reference in docs/
→ Runnable examples in examples/
```

**Conventions:**
- Each snippet ≤ 10 lines
- No `console.log` — annotate values with comments
- Link to the relevant `examples/` file at the end of each snippet

---

## Order of execution

1. **Tier 1** first — it's the lowest effort and highest value (IDE discoverability)
2. **Tier 2** second — write examples top-down, starting with `counter.ts`
3. **Tier 3** last — README is easiest to write once the examples exist to reference
