# H1: Markdown Editor

Split-pane: CodeMirror left, live Markdown preview right. Toolbar with undo/redo, word count, cursor position, auto-save indicator.

## Files (planned)

- `store.ts` — `textEditor`, `textBuffer`, `undoRedo`, `checkpoint`, `state`, `derived`, `debounce`, `scan`
- `MarkdownEditor.vue` — CodeMirror integration, preview pane, toolbar
