# SESSION: Full Repo Audit + Design Principles Codification

**Date:** 2026-03-20
**Topic:** Comprehensive audit of all 138 modules against architecture doc. Codified new design principles, unified import hierarchy, identified companion store standardization gap.

---

## KEY DISCUSSIONS

### 1. Import Hierarchy Unification

**Before:** Import rules were inconsistent — adapters could only import `core/` (couldn't use `withStatus` from `utils/`), intra-folder imports for `utils/` and `orchestrate/` weren't documented, `data/` position in hierarchy was unclear.

**After:** Five-tier model with `data/` as cross-cutting:

```
Tier 0 (foundation)   core/
Tier 1 (operators)    extra/
Tier 2 (utilities)    utils/
Tier 3 (domains)      orchestrate/    memory/
Tier 4 (surface)      patterns/    adapters/    compat/
```

`data/` importable from any tier (core excluded). Intra-folder imports explicitly blessed.

**Key change:** `adapters/` can now import from `core/`, `extra/`, `utils/`, and `data/`. This unlocks Phase 5a-3 (adapter `withStatus` reuse).

### 2. High-Level API Principle (§1.14)

**New principle codified:** High-level layers (`orchestrate/`, `patterns/`, `adapters/`, `compat/`) must speak domain language, not callbag protocol. If internals must be exposed, they go under an `inner` property.

**Motivation:** The user's explicit request — "orchestration should have workflow nodes that work well with workflow semantics and refrain from exposing the low level callbag status, values, methods."

**API leakage audit found 25+ clean modules, 11 violations across 3 categories:**

**Type-level (HIGH — callbag protocol in public types):**
1. `taskState.source` — raw callbag source `(type: number, payload?: any) => void` on public type
2. `task._taskState` — underscore-prefixed but publicly accessible
3. `PipelineInner` type comments reference "callbag DATA/END signals"

**JSDoc (MEDIUM — protocol terminology in user-facing docs):**
4. `gate.ts` @returnsTable labels `source` as "callbag"
5. `gate.ts` @remarks mentions "DIRTY+value cycle"
6. `branch.ts` @remarks mentions "RESOLVED signals"
7. `http.ts` @remarks mentions "DIRTY+value cycle"
8. `websocket.ts` @remarks mentions "DIRTY+value cycle"
9. `webhook.ts` @remarks mentions "DIRTY+value cycle"
10. `createStore` destroy() JSDoc mentions "sends END"

**Export-level (LOW):**
11. `createStore` re-exports `teardown` (protocol-level primitive)

Items 1-2 to be fixed in Phase 5a-0.1/5a-0.2. Items 3-11 to be fixed in Phase 5a-0.3 (JSDoc sanitization).

### 3. Companion Store vs Packed Metadata Decision

**Question:** Should status/error/duration/etc be individual companion `Store` properties, or packed into a single `Store<{status, error, ...}>`?

**Data:** 8 modules use companion stores (withStatus, fromHTTP, fromWebSocket, chatStream, formField, pagination, toolCallState, agentLoop). 1 module uses packed metadata (taskState). The codebase has already converged on companion stores.

**Decision:** Standardize on companion stores everywhere. Refactor `taskState` in Phase 5a.

**Critical design implication from optimizations:** When multiple companion stores update simultaneously (e.g., status + error + duration on task completion), they MUST be wrapped in `batch()` to prevent N separate effect runs. This is a must-have for Phase 5a.

### 4. Optimization Cross-Reference

Reviewed all 21 built-in optimizations + 5 potential + 6 rejected for design pattern implications.

**Design-relevant findings:**
- `batch()` is critical for companion store transitions (multiple stores updated atomically)
- `equals` on companion stores: `Object.is` (default) is correct for status enums and error refs
- SINGLE_DEP optimization applies naturally to companion stores — effects subscribing to just `task.status` get 50% dispatch reduction for free
- Cancellation-safe pipeline reset (AbortSignal) should be bundled with Phase 5a to avoid two breaking changes
- `validationPipeline` composition refactor is a code quality improvement, not a design pattern change

**No design implications from:**
- Class/output slot/bitmask/flags optimizations (pure perf internals)
- Integer _status packing (hidden behind getter)
- pipeRaw, raw callbag interop, cached() (escape hatches, not patterns)
- All "Not implementing" items (rejected on perf grounds, not design)

### 5. reactiveList NodeV0 Fix

`reactiveList` was the only data structure not extending `NodeV0`. Fixed:
- Added `id: string` and `version: number` (getter) to satisfy NodeV0 contract
- Renamed `version: Store<number>` → `versionStore: Store<number>` for reactive subscriptions
- Added `ListSnapshot<T>` type following the same pattern as `MapSnapshot`, `LogSnapshot`, etc.
- Updated `snapshot()` return type from `readonly T[]` to `ListSnapshot<T>`

---

## REJECTED ALTERNATIVES

1. **Move `withStatus` to `core/`** — Rejected in favor of relaxing adapter import rules. `withStatus` is a utility, not a foundation primitive. Tier 2 (utils) is the right home.

2. **Keep packed TaskMeta** — Rejected because it's the only module using this pattern. Companion stores are the standard. Packed values can't be individually piped or selectively subscribed.

3. **Keep import rule inconsistencies** — Could have documented "adapters are core-only by design." Rejected because it forced all 6 adapters to duplicate `withStatus` logic, and the restriction was arbitrary (adapters clearly benefit from utils like backoff, eviction).

4. **File-level inventory in architecture doc** — User explicitly said "I don't think we care the actual count." Kept the folder listing with brief notes, no per-file enumeration.

---

## KEY INSIGHTS

1. **The codebase already converged on companion stores** — taskState was the lone holdout, not a deliberate alternative design. The audit proved this empirically (8:1 ratio).

2. **`batch()` is the companion store's secret weapon** — Without batch, transitioning from `running → success` with 4 companion stores means 4 effect runs. With batch, it's 1. This is why batch exists — it was designed for exactly this use case.

3. **`inner` property is already the convention** — `pipeline().inner` already isolates stream lifecycle and step metadata. The principle just codifies what the code already does.

4. **The tier diagram captures real dependency flow** — The 5-tier visualization makes import rules intuitive. "Can I import X from Y?" → just check if X's tier is below Y's tier.

---

## OUTCOME

**Architecture doc changes:**
- §1.14: High-level API principle (domain language, `inner` property)
- §2: 5-tier dependency diagram, updated folder listing, data cross-cutting, intra-folder blessed, adapter/compat rules relaxed
- §19: Orchestrate table unified (no "internal plumbing" split), utils expanded with categories, reactiveList added to data table

**Code changes:**
- `reactiveList` extends `NodeV0` (id, version getter, ListSnapshot type)
- `data/types.ts`: ListSnapshot<T> added
- `data/index.ts`: ListSnapshot exported

**Roadmap additions:**
- Phase 5a: Uniform Metadata Pattern (taskState companion refactor + task flat companions + adapter withStatus reuse)
- Phase 5a-0 (immediate): §1.14 compliance audit and fixes across all high-level modules

**Optimizations doc:**
- Cross-reference: cancellation-safe pipeline reset should be bundled with Phase 5a

**Tests:** 2150/2150 passing, build clean, lint clean.

---

## FILES CHANGED

- `docs/architecture.md` — §1.14, §2, §19 updated
- `docs/roadmap.md` — Phase 5a added
- `docs/optimizations.md` — Cross-reference added
- `src/data/reactiveList.ts` — NodeV0 extension
- `src/data/types.ts` — ListSnapshot type
- `src/data/index.ts` — ListSnapshot export
- `src/__tests__/data/reactiveList.test.ts` — Tests updated for new API
