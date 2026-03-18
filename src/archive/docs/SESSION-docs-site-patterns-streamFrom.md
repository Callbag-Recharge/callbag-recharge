---
SESSION: docs-site-patterns-streamFrom
DATE: March 17, 2026
TOPIC: Docs site fixes, single-source examples, CI cleanup, and the switchMap footgun → streamFrom pattern proposal
---

## KEY DISCUSSION

### 1. Docs Site Fixes

**HomeLayout.vue empty sections bug:** Template referenced `features` and `primitives` but data was defined as `_features` and `_primitives`. Fixed by renaming. Sections now render correctly.

**AI chat streaming example was broken:**
- `switchMap`, `scan` are `StoreOperator` (curried) — must be used via `pipe()`, not called directly with a source
- Original code: `scan(chunks, reducer, seed)` — WRONG (RxJS syntax, not ours)
- Fixed code: `pipe(prompt, filter(...), switchMap(...), filter(undefined), scan(...))`
- Took 3 iterations to get right — this is the usability problem (see §3)

### 2. Single-Source Examples Strategy

**Problem:** `examples/streaming.ts` and `site/recipes/ai-chat-streaming.md` had divergent code with different bugs. Two places to maintain = guaranteed divergence.

**Solution:** VitePress code snippet imports.
```md
<<< @/../examples/streaming.ts
```
This pulls code directly from the `.ts` file. One source of truth.

**Five-tier documentation model established:**
1. **Tier 1:** JSDoc `@example` in source files (IDE tooltips)
2. **Tier 2:** `examples/` directory (runnable `.ts` files, verified by execution)
3. **Tier 3:** `site/recipes/` (VitePress markdown importing from `examples/`)
4. **Tier 4:** Pattern READMEs (`src/patterns/<name>/README.md` — canonical API docs)
5. **Tier 5:** `llms.txt` / `llms-full.txt` (AI-readable, updated periodically)

### 3. The switchMap Footgun — Critical Usability Issue

**What happened:** Even Claude (me) got the streaming example wrong multiple times:

1. First attempt: Used `scan(source, reducer, seed)` — wrong API (it's curried)
2. Second attempt: Used `pipe()` but `switchMap` emitted `undefined` initially
3. Third attempt: Added `filter(undefined)` after `switchMap` — works but defensive

**Root cause:** `switchMap` eagerly evaluates `fn(outer.get())` at construction time. For `state('')`, this calls `fn('')` immediately, creating an inner producer whose initial value is `undefined`. This `undefined` leaks through `scan` as `'' + undefined = 'undefined'`.

**The 5-operator tax for streaming:**
```ts
pipe(
  prompt,
  filter(p => p.length > 0),        // skip empty
  switchMap(p => producer(...)),      // cancel + stream
  filter(chunk => chunk !== undefined), // skip initial undefined
  scan((acc, chunk) => acc + chunk, ''), // accumulate
)
```

**User's concern:** "If you get mistaken, other AI will too, let alone humans. They're not reading 500 pages of API documents."

**This is a valid architecture concern, not a bug.** The primitives are correct. The mental model burden is the problem.

### 4. Proposed Solution: `streamFrom` Pattern

A higher-level abstraction in `src/patterns/` that hides the footguns:

```ts
import { streamFrom } from 'callbag-recharge/patterns/streamFrom'

const response = streamFrom(prompt, async function* (p, signal) {
  const res = await fetch('/api/chat', { body: p, signal })
  for await (const chunk of res.body) {
    yield decoder.decode(chunk)
  }
})

// response.chunks  — Store<string> (latest chunk)
// response.value   — Store<string> (accumulated)
// response.loading — Store<boolean>
// response.error   — Store<Error | undefined>
```

**Design principles:**
- Takes an async generator (most natural way to express streaming)
- Auto-cancels via `AbortSignal` (passed to the generator)
- Accumulates chunks automatically
- Exposes `loading` and `error` stores
- Built on existing primitives internally (producer + switchMap + scan + filter)
- Lives in `src/patterns/` — tree-shakeable, doesn't bloat core

**Also proposed: `cancellable` pattern** for non-streaming async:
```ts
const userData = cancellable(userId, async (id, signal) => {
  return fetch(`/api/user/${id}`, { signal }).then(r => r.json())
})
// userData.value, userData.loading, userData.error
```

**Status: NOT YET IMPLEMENTED. Design discussion only.** Next session should implement these.

### 5. Other Changes Made

**CI cleanup:**
- Removed bundle-size auto-update from `.github/workflows/docs.yml`
- No more bot commits updating README/llms.txt with bundle size
- Removed `contents: write` permission from build job
- Added `examples/` to docs trigger paths

**Dependencies cleaned:**
- Removed `@preact/signals-core` from devDependencies
- Removed `callbag-basics`, `callbag-filter`, `callbag-map`, `callbag-pipe`, `callbag-subscribe`
- Benchmarks already clean (self-comparison only, no external packages)

**New content:**
- `examples/create-store.ts` — runnable createStore example (verified)
- `site/recipes/zustand-migration.md` — recipe using VitePress snippet import
- `docs/examples-plan.md` — rewritten with 5-tier guidance

**Answers provided:**
- `llms.txt` hosting: already works via `site/public/` → GitHub Pages
- `llms.txt` update cadence: when adding user-facing features, not every commit
- AI chat demo: feasible with Level 1-2 primitives only (no Phase 3 needed)

---

## REJECTED ALTERNATIVES

- **Fix switchMap to not eagerly evaluate** — rejected because it's the correct callbag lazy-start contract. The eagerness is needed for `switchMap(state).get()` to return a value immediately.
- **Add `skipInitial` option to switchMap** — possible but treats the symptom. Users still need to know about it.
- **Make scan ignore undefined** — breaks general-purpose semantics. `undefined` is a valid value.
- **Blog engine for VitePress** — over-engineering. Recipes under `site/recipes/` serve the same purpose without adding complexity.
- **MDX instead of VitePress markdown** — VitePress already supports code snippet imports. MDX would require config changes and doesn't add enough value.

## KEY INSIGHTS

1. **The 5-operator streaming tax is a real usability problem.** If Claude gets it wrong in 3 attempts, every human and AI will struggle. Higher-level patterns (`streamFrom`, `cancellable`) are not optional — they're required for adoption.

2. **Single-source examples prevent divergence.** VitePress `<<<` imports are the right mechanism. The `examples/` directory is the canonical code; docs reference it.

3. **The switchMap initial-value leak is architecturally correct but ergonomically wrong.** It's the callbag contract working as designed, but users don't think in terms of "eager initial evaluation." Patterns must hide this.

4. **Bundle-size CI was noisy.** Auto-committing README changes on every push creates noise in git history. Better to check size manually or in PR reviews.

## FILES CHANGED

| File | Action |
|---|---|
| `site/.vitepress/theme/components/HomeLayout.vue` | Fixed `_features`/`_primitives` → `features`/`primitives` |
| `examples/streaming.ts` | Rewritten with correct `pipe()` usage |
| `site/recipes/ai-chat-streaming.md` | Now uses `<<< @/../examples/streaming.ts` |
| `examples/create-store.ts` | Created — runnable createStore example |
| `site/recipes/zustand-migration.md` | Created — recipe with snippet import |
| `site/recipes/index.md` | Updated with new recipes |
| `site/.vitepress/config.ts` | Added zustand-migration to sidebar |
| `.github/workflows/docs.yml` | Removed bundle-size auto-update |
| `docs/examples-plan.md` | Rewritten with 5-tier guidance |
| `package.json` | Removed preact + callbag comparison deps |
| `pnpm-lock.yaml` | Updated |

## NEXT SESSION TODO

1. **Implement `streamFrom` pattern** — `src/patterns/streamFrom/index.ts`
2. **Implement `cancellable` pattern** — `src/patterns/cancellable/index.ts`
3. **Investigate switchMap initial value** — document or add `skipInitial` option
4. **Update `examples/streaming.ts`** to use `streamFrom` once implemented
5. **Update `llms.txt`** and `llms-full.txt` with new patterns

---END SESSION---
