---
layout: doc
---

# Form Builder

Multi-field registration form with sync + async validation, derived aggregation for form-level state.

**Try it:** Fill in the fields — validation runs in real-time. The email field simulates an async uniqueness check with debounce. Submit is disabled until all fields are valid.

<ClientOnly>
  <FormBuilder />
</ClientOnly>

## What it demonstrates

| Primitive | Module | Role |
|-----------|--------|------|
| `formField` | `patterns/formField` | Per-field reactive validation (sync + async) |
| `derived` | `core` | Form-level `allValid`, `anyDirty`, `anyValidating` aggregation |
| `useSubscribe` | `compat/vue` | Bridge stores to Vue refs |

## How it works

Each field is a `formField()` — a self-contained reactive unit with `value`, `error`, `dirty`, `touched`, `valid`, and `validating` stores. Sync validators run immediately on value change. Async validators are debounced (300ms default) and auto-cancelled via AbortSignal.

Form-level stores (`allValid`, `anyDirty`) are `derived()` from all field stores — diamond resolution ensures they update exactly once per change.

All tree-shakeable. Zero framework lock-in.
