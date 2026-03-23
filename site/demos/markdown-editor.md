---
title: "Markdown Editor"
outline: false
---

<style>
.VPDoc .container { max-width: 1200px; }
</style>

# Markdown Editor

<ClientOnly>
  <MarkdownEditor />
</ClientOnly>

## What's happening

A split-pane Markdown editor with live preview, powered entirely by callbag-recharge reactive stores.

**Left pane:** Text editor with keyboard shortcuts (Ctrl+Z undo, Ctrl+Y redo, Tab indent). All text operations go through the `textEditor` pattern which manages a reactive buffer with undo/redo history.

**Right pane:** Live Markdown preview. The `textEditor` pattern's markdown transform renders HTML reactively as you type.

**Toolbar:** Undo/redo, heading/bold/italic/code/list insertion, word/character/line count, cursor position — all derived reactively from the editor buffer.

**Auto-save:** Content is debounced (1.5s quiet) then checkpointed via `autoSave()`. The green/yellow/gray dot shows save status.

## Primitives used

- **`textEditor()`** — Pattern: buffer + commands + validation + markdown preview
- **`contentStats()`** — Utility: reactive word/char/line count from any `Store<string>`
- **`cursorInfo()`** — Utility: reactive line/column from content + cursor position
- **`autoSave()`** — Utility: debounce + checkpoint + status in one call
- **`memoryAdapter()`** — In-memory checkpoint persistence (swap to `indexedDBAdapter` for production)
