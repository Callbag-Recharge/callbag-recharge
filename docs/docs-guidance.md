# Documentation Guidance

Single-source-of-truth strategy: **JSDoc in source → generated API docs → site**. Code and docs live in ONE place.

---

## How API docs are generated

API reference pages (`site/api/*.md`) are **generated** from structured JSDoc on exported functions via `scripts/gen-api-docs.mjs`.

```bash
pnpm run docs:gen              # regenerate all registered entries
pnpm run docs:gen state map    # specific functions only
pnpm run docs:gen:check        # CI dry-run — exit 1 if stale
```

The generator reads structured JSDoc tags from source, extracts the function signature via the TypeScript compiler, and emits markdown matching the API page template.

**Do NOT edit `site/api/*.md` by hand** — except for `inspector.md` and `protocol.md` which are manually maintained (see below). For all other pages, edit the JSDoc in source, then run `pnpm run docs:gen`.

To add a new function to the generator, register it in `scripts/gen-api-docs.mjs` in the `REGISTRY` object.

---

## Manually maintained API pages

Two API pages are **not generated** by `gen-api-docs.mjs` and must be updated by hand:

| Page | Source | Why manual |
|------|--------|------------|
| `site/api/inspector.md` | `src/core/inspector.ts` | Static class with many methods — doesn't fit the single-function generator model. |
| `site/api/protocol.md` | `src/core/protocol.ts` | Documents constants, types, and helpers — not a single exported function. |

**When to check:** Any time `src/core/inspector.ts` or `src/core/protocol.ts` changes, review the corresponding `site/api/*.md` page and update it to match. Look for added/removed/renamed methods, changed signatures, new types, or updated behavior.

---

## Tier 0 — Structured JSDoc on exported functions (source of truth)

Every exported function must have a structured JSDoc block. This is the **single source of truth** for API documentation. The generator (`scripts/gen-api-docs.mjs`) reads these tags and produces `site/api/*.md`.

### Required JSDoc tags

| Tag | Purpose | Format |
|-----|---------|--------|
| *(first line)* | Description | Plain text. One or two sentences. |
| `@param` | Parameter docs | `@param name - Description.` |
| `@returns` | Return type description | `` @returns `ReturnType<T>` — description. `` |
| `@example` | Code examples (multiple allowed) | Optional title on first line, then `` ```ts `` code block. |
| `@seeAlso` | Cross-references | Comma-separated markdown links. |

### Optional JSDoc tags

| Tag | Purpose | Format |
|-----|---------|--------|
| `@remarks` | Behavior detail bullets | One `@remarks` per bullet. Start with `**Bold title:**`. |
| `@returnsTable` | Methods table for return type | Pipe-separated rows: `method \| signature \| description` |
| `@optionsType` | Name of options interface | `@optionsType StoreOptions` |
| `@option` | Options table row | `@option property \| type \| default \| description` |
| `@category` | Module category | `core`, `extra`, `data`, `memory`, `orchestrate`, `patterns` |

### Template: core primitive (e.g. `state`)

```ts
/**
 * Creates a writable reactive store with an initial value and optional equality check.
 *
 * @param initial - The initial value of the store.
 * @param opts - Optional configuration.
 *
 * @returns `WritableStore<T>` — a store with the following API:
 *
 * @returnsTable get() | () => T | Returns the current value.
 * set(value) | (value: T) => void | Sets a new value and notifies subscribers.
 * update(fn) | (fn: (current: T) => T) => void | Updates the value using a function of the current value.
 * source | callbag | The underlying callbag source for subscriptions.
 *
 * @optionsType StoreOptions
 * @option name | string | undefined | Debug name for Inspector.
 * @option equals | (a: T, b: T) => boolean | Object.is | Equality function to prevent redundant emissions.
 *
 * @remarks **Equality guard:** `equals` defaults to `Object.is`. If `set()` is called with a value equal to the current value, the emission is skipped entirely.
 * @remarks **Post-completion no-op:** `set()` is a no-op after `complete()` or `error()`.
 * @remarks **Batching:** Within `batch()`, DIRTY signals propagate immediately but DATA emission is deferred until the outermost batch ends.
 * @remarks **Pre-bound `set`:** The `set` method is bound at construction, so it is safe to destructure: `const { set } = myState`.
 *
 * @example
 * ```ts
 * import { state } from 'callbag-recharge';
 *
 * const count = state(0);
 *
 * count.get(); // 0
 * count.set(1);
 * count.get(); // 1
 * ```
 *
 * @example Update with a function
 * ```ts
 * const count = state(0);
 * count.update(n => n + 1);
 * count.get(); // 1
 * ```
 *
 * @seeAlso [derived](./derived) — computed stores, [effect](./effect) — side-effects, [batch](./batch) — atomic updates
 */
export function state<T>(initial: T, opts?: StoreOptions<T>): WritableStore<T>
```

### Template: extra operator (e.g. `map`)

```ts
/**
 * Transforms each upstream value through `fn`. Returns a `StoreOperator` for use with `pipe()`.
 *
 * @param fn - Transform function applied to each upstream value.
 * @param opts - Optional configuration.
 *
 * @returns `StoreOperator<A, B>` — a function that takes a `Store<A>` and returns a `Store<B>`.
 *
 * @optionsType StoreOptions
 * @option name | string | undefined | Debug name for Inspector.
 * @option equals | (a: B, b: B) => boolean | undefined | Push-phase memoization.
 *
 * @remarks **Tier 1:** Participates in diamond resolution. Forwards type 3 STATE signals from upstream.
 * @remarks **Stateful:** Maintains the last transformed value. `get()` returns `fn(input.get())` when disconnected.
 *
 * @example
 * ```ts
 * import { state, pipe } from 'callbag-recharge';
 * import { map } from 'callbag-recharge/extra';
 *
 * const count = state(3);
 * const doubled = pipe(count, map(x => x * 2));
 * doubled.get(); // 6
 * ```
 *
 * @seeAlso [pipe](/api/pipe) — compose operators, [derived](/api/derived) — computed stores
 *
 * @category extra
 */
export function map<A, B>(fn: (value: A) => B, opts?: StoreOptions): StoreOperator<A, B>
```

### Generated output

The generator produces `site/api/<name>.md` with this structure:

```
# name()
[description]

## Signature
[TypeScript signature from source]

## Parameters
[table from @param tags]

### OptionsType
[table from @option tags]

## Returns
[@returns text]
[table from @returnsTable]

## Basic Usage
[first @example code block]

## Options / Behavior Details
[bullets from @remarks]

## Examples
### [title from @example]
[code block]
...

## See Also
[links from @seeAlso]
```

### JSDoc conventions

- **Overloaded functions:** Put the structured JSDoc block immediately **above the implementation** (the declaration with a `{` body). JSDoc above imports or above overload signatures only is not picked up by `gen-api-docs.mjs`.
- **Description:** One or two sentences. Start with a verb ("Creates", "Transforms", "Delays").
- **@param:** Use `@param name - Description.` format (the `- ` is stripped by the generator).
- **@example:** First example has no title (becomes "Basic Usage"). Additional examples have a title on the first line before the code fence. Include `import` statements in the first example. Show return values as inline comments, not `console.log`.
- **@remarks:** One `@remarks` tag per bullet. Start with `**Bold keyword:**`. Include tier info for extras (`Tier 1` or `Tier 2`).
- **@seeAlso:** Comma-separated markdown links. Use `./name` for same-directory, `/api/name` for cross-directory.
- **@option:** Use `undefined` as default when there is no default.
- **Code indentation:** TSDoc strips leading spaces from `*` lines. The generator auto-reindents based on brace tracking. Write code with normal indentation.

---

## Tier 1 — JSDoc `@example` in source files

The structured JSDoc above serves double duty:
1. **IDE tooltips** — `@example` blocks appear in hover documentation
2. **Generated API pages** — all tags feed into `site/api/*.md`

**Conventions for `@example` blocks:**
- First `@example` = basic usage (shown in IDE + becomes "Basic Usage" section)
- Additional `@example` = advanced patterns (titled, shown in "Examples" section)
- Show return values in comments, not `console.log`
- Show teardown / dispose where relevant (effect, subscribe)

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
- `site/recipes/zustand-migration.md` — createStore pattern, migration from Zustand

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
2. **Structured JSDoc** on the exported function (Tier 0) — this is the source of truth
3. **Register** in `scripts/gen-api-docs.mjs` REGISTRY, run `pnpm run docs:gen`
4. **Runnable example** in `examples/` (Tier 2) — if the feature warrants a standalone demo
5. **Recipe** on the site that imports from `examples/` (Tier 3) — for complex patterns
6. **Update llms.txt/llms-full.txt** if the feature is user-facing (Tier 5)

---

## File locations summary

| What | Where | Editable? |
|------|-------|-----------|
| Source of truth (JSDoc) | `src/core/*.ts`, `src/extra/*.ts`, etc. | Yes — primary edit target |
| API doc generator | `scripts/gen-api-docs.mjs` | Yes — add new entries to REGISTRY |
| Generated API pages | `site/api/*.md` | **No** — regenerated from JSDoc |
| Manually maintained pages | `site/api/inspector.md`, `site/api/protocol.md` | Yes — check ad-hoc when source changes |
| Runnable examples | `examples/*.ts` | Yes |
| Recipes | `site/recipes/*.md` | Yes — import code from `examples/` |
| Pattern READMEs | `src/patterns/<name>/README.md` | Yes |
| AI docs | `llms.txt`, `llms-full.txt` | Yes — updated periodically |
| VitePress config | `site/.vitepress/config.ts` | Yes — update sidebar when adding pages |
