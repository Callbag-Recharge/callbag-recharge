# Compat

Drop-in API replacements for popular state libraries, backed by callbag-recharge primitives.

| Module | Import | Wraps | Lines |
|--------|--------|-------|-------|
| **nanostores** | `callbag-recharge/compat/nanostores` | `atom`, `computed`, `map` | ~30 |
| **signals** | `callbag-recharge/compat/signals` | `Signal.State`, `Signal.Computed`, `Signal.subtle.Watcher` | ~70 |
| **jotai** | `callbag-recharge/compat/jotai` | `atom` (primitive, derived, writable-derived) | ~100 |
| **zustand** | `callbag-recharge/compat/zustand` | `create` (set/get contract) | ~50 |

All compat layers use only `core/` imports (`state`, `derived`, `effect`, `subscribe`). Zero overhead wrappers — each module delegates directly to callbag-recharge primitives.
