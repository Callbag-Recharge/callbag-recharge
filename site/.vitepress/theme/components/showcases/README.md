# Showcases

Polished hero apps for the homepage. Users interact with them as products — no code panel, no API legend.

Each showcase is a directory with:
- `store.ts` — pure library code (state, derived, effects, patterns). No Vue imports.
- `<Name>.vue` — Vue component that bridges to library stores via `subscribe()`.

## Current

| Dir | App | Status |
|-----|-----|--------|
| `MarkdownEditor/` | Split-pane markdown editor with undo/redo, word count, auto-save | Planned (H1) |
| `AIChat/` | In-browser LLM chat via WebLLM, streaming, token meter | Planned (H2) |
| `WorkflowBuilder/` | Code-first n8n: write pipeline code, live DAG, fire triggers, persist to IndexedDB | Planned (H3) |
