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

Extra operators follow the same pattern — add `@category extra` and tier info in `@remarks`.

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

## Documentation tiers

| Tier | Location | Purpose | Key rule |
|------|----------|---------|----------|
| **1** | `@example` in JSDoc | IDE tooltips + feeds generated API pages | First = basic usage; additional = titled advanced patterns. Show return values as comments, not `console.log`. |
| **2** | `examples/*.ts` | Runnable standalone scripts (`npx tsx examples/<name>.ts`) | Self-contained, clean up at end, JSDoc comment at top. |
| **3** | `site/recipes/*.md` | Long-form VitePress docs with context and variations | **Pull code from `examples/`** via `<<< @/../examples/<name>.ts` — never duplicate. |
| **4** | `src/patterns/<name>/` | Published reusable patterns (npm package) | Pattern `README.md` is canonical API reference. Recipe links to it. |
| **5** | `llms.txt` / `llms-full.txt` | AI-readable docs (repo root + `site/public/`) | Update when adding new primitives/operators/patterns, not on bug fixes. |

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
