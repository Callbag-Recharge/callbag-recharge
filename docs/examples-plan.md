# Examples & Recipes Guidance

Single-source-of-truth strategy: code lives in ONE place, docs pull from it.

---

## Tier 1 — JSDoc `@example` in source files

Add TSDoc `@example` blocks directly on each exported function. These appear in IDE hover tooltips.

**Conventions:**
- One `@example` per function (add a second only for meaningfully different usage, e.g. `equals` option)
- Show the return value in a comment, not `console.log`
- Show teardown / dispose where relevant (effect, subscribe)

**Example:**
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

---

## Tier 2 — `examples/` directory (runnable files)

Longer, multi-primitive examples that show realistic patterns. Each file is a standalone `.ts` script that can be run with `npx tsx examples/<name>.ts`.

**Current examples:**
| File | Demonstrates |
|------|-------------|
| `examples/counter.ts` | `state` + `derived` + `effect` — basic reactive counter |
| `examples/diamond.ts` | Diamond dependency graph — shows single-fire guarantee |
| `examples/batch.ts` | `batch()` — multiple `set()` calls coalesced into one effect run |
| `examples/pipe-operators.ts` | `pipe()` with `map`, `filter`, `scan` — transformation chain |
| `examples/streaming.ts` | AI chat streaming with `producer` + `switchMap` + `scan` |

**Planned:**
| File | Demonstrates |
|------|-------------|
| `examples/producer-push.ts` | `producer` push source + `subscribe` — e.g. simulated WebSocket |
| `examples/reactive-map.ts` | `reactiveMap` — CRUD, select, events, TTL |
| `examples/cron-pipeline.ts` | `fromCron` + `taskState` + diamond resolution — Airflow-in-TypeScript |
| `examples/create-store.ts` | `createStore` — Zustand-compatible API with diamond-safe selectors |

**Conventions:**
- Each file is self-contained: imports only from `callbag-recharge` or Node built-ins
- Dispose / clean up at the end so the script exits cleanly
- A short JSDoc comment block at the top explains what pattern the file demonstrates

---

## Tier 3 — Recipes (site/recipes/)

Recipes are longer-form docs on the VitePress site that explain patterns with context, rationale, and variations.

**Key rule: recipes pull code from `examples/` — don't duplicate code.**

Use VitePress code snippet imports:
```md
<<< @/../examples/streaming.ts
```

This pulls the code directly from the `.ts` file. When you update the example, the recipe updates automatically.

For inline code snippets in recipes (e.g. showing a variation), use fenced code blocks. But the primary example should always be imported from `examples/`.

**Current recipes:**
- `site/recipes/ai-chat-streaming.md` — AI chat with streaming, auto-cancellation, retry

**Planned:**
- `site/recipes/zustand-migration.md` — createStore pattern, migration from Zustand
- `site/recipes/reactive-data-pipeline.md` — ETL with fromAsyncIter + bufferCount
- `site/recipes/cron-pipeline.md` — Airflow-in-TypeScript with fromCron + taskState

---

## Tier 4 — Pattern source code (`src/patterns/`)

Patterns are reusable, published code (shipped in the npm package). Each pattern has:
- `src/patterns/<name>/index.ts` — the implementation
- `src/patterns/<name>/README.md` — full API docs, migration guide, comparison table

The pattern README is the **canonical API reference** for that pattern. The recipe on the site links to it or pulls content from it. Don't duplicate the API docs in the recipe.

**Workflow for a new pattern:**
1. Write the implementation in `src/patterns/<name>/index.ts`
2. Write tests in `src/__tests__/patterns/<name>.test.ts`
3. Write the README in `src/patterns/<name>/README.md`
4. Write a runnable example in `examples/<name>.ts`
5. Write a recipe in `site/recipes/<name>.md` that:
   - Uses `<<< @/../examples/<name>.ts` for the primary code
   - Links to the pattern README for full API docs
   - Adds context, variations, and framework integration

---

## Tier 5 — llms.txt / llms-full.txt

AI-readable documentation at the repo root. Updated periodically (not on every commit).

- `llms.txt` — concise summary (< 4KB) for quick AI tool consumption
- `llms-full.txt` — comprehensive reference with all APIs and examples

These are also served at the docs site via `site/public/llms.txt` and `site/public/llms-full.txt`.

**When to update:** When you add a new primitive, operator, data structure, or pattern. Not for every bug fix or internal refactor.

---

## Order of execution for new features

1. **Implementation** in `src/` + tests
2. **JSDoc `@example`** on the exported function (Tier 1)
3. **Runnable example** in `examples/` (Tier 2)
4. **Recipe** on the site that imports from `examples/` (Tier 3)
5. **Update llms.txt/llms-full.txt** if the feature is user-facing (Tier 5)
