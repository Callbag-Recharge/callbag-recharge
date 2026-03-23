# H1: Markdown Editor

Split-pane: CodeMirror left, live Markdown preview right. Toolbar with undo/redo, word count, cursor position, auto-save indicator.

## Store layer (done)

`examples/markdown-editor-hero.ts` — `createMarkdownEditorHero()` factory.

**Primitives used:** `textEditor` (pattern), `derived` (word count, char count, line count, cursor display), `state` (auto-save status), `pipe` + `debounce` (auto-save trigger), `checkpoint` + `memoryAdapter` (persistence), `effect` (dirty/save status sync).

**Exported interface:**
- `editor` — full `TextEditorResult` (buffer, commands, validation, preview)
- `wordCount`, `charCount`, `lineCount` — reactive derived stats
- `cursorDisplay` — `"Ln X, Col Y"` string
- `autoSaveStatus` — `"saved" | "saving" | "unsaved"`
- `debouncedContent` — debounced content for auto-save
- `dispose()` — cleanup

## TDD tests (done)

`src/__tests__/showcases/markdown-editor-hero.test.ts` — 30 tests covering:
- Markdown preview (headings, bold/italic/code, lists, code blocks, XSS, links)
- Editor basics (empty/initial content, reactive preview)
- Undo/redo round-trips
- Word/char/line count reactivity
- Cursor display formatting
- Validation (maxLength, custom validators)
- Auto-save (debounce timing, checkpoint persistence, status transitions)
- Commands (heading, undo, redo)
- Dispose cleanup

## Vue component (next)

`MarkdownEditor.vue` — CodeMirror integration, preview pane, toolbar. UI-only; imports from `@examples/markdown-editor-hero`.

### Configuration options

- `initial` — starting markdown content
- `maxLength` — character limit
- `autoSaveMs` — debounce interval (default 1000ms)
- `adapter` — checkpoint adapter (default: memoryAdapter, swap to indexedDBAdapter for prod)
- `validators` — custom validation rules
