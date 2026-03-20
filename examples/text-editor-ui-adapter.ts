/**
 * Canonical UI adapter contract — wiring `textEditor` / `textBuffer` to a `<textarea>`
 *
 * Run (optional smoke): `pnpm exec tsx --tsconfig tsconfig.examples.json examples/text-editor-ui-adapter.ts`
 *
 * -----------------------------------------------------------------------------
 * 1. Source of truth
 * -----------------------------------------------------------------------------
 * - Treat `editor.buffer.content` as the document string the user edits.
 * - Treat `editor.buffer.cursor` (start/end stores) as the logical selection.
 * - After every programmatic change (commands, validation-driven replace, etc.),
 *   re-read `content.get()` and cursor positions before touching the DOM.
 *
 * -----------------------------------------------------------------------------
 * 2. Textarea value sync (controlled pattern)
 * -----------------------------------------------------------------------------
 * On each reactive update you care about (`subscribe` from `callbag-recharge/extra`,
 * or your framework’s effect):
 * - Set `textarea.value = editor.buffer.content.get()` **only when** the string
 *   differs from the current DOM value to avoid fighting IME composition.
 * - Then restore selection:
 *   `textarea.selectionStart = editor.buffer.cursor.start.get()`
 *   `textarea.selectionEnd = editor.buffer.cursor.end.get()`
 *
 * For simple demos you may `replaceAll` from the full textarea value on `input`;
 * production editors usually compute a minimal edit (diff) and call `insert` /
 * `delete` / `replaceRange` so undo history stays meaningful.
 *
 * -----------------------------------------------------------------------------
 * 3. DOM → buffer (user typing)
 * -----------------------------------------------------------------------------
 * On `input` (and sometimes `beforeinput` for better control):
 * - Read `textarea.value`, `selectionStart`, `selectionEnd`.
 * - Map selection into the buffer: `buffer.cursor.select(start, end)` then apply
 *   the text delta, or use `replaceAll` for a first cut.
 * - Do **not** call the browser’s undo stack for document changes; see below.
 *
 * -----------------------------------------------------------------------------
 * 4. Undo / redo
 * -----------------------------------------------------------------------------
 * - Wire Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z (or platform shortcuts) to
 *   `editor.commands.dispatch("undo")` and `editor.commands.dispatch("redo")`.
 * - Those commands advance `buffer.history`, which restores **both** text and
 *   selection snapshots. Skip `document.execCommand("undo")` — it bypasses the
 *   buffer and desynchronizes the textarea.
 *
 * -----------------------------------------------------------------------------
 * 5. Preview / validation
 * -----------------------------------------------------------------------------
 * - `editor.preview` and `editor.error` / `editor.valid` are derived from
 *   `buffer.content`; update the preview pane in the same subscription as content.
 * - `canSubmit` already accounts for `valid` and `submitting`; disable the submit
 *   button when `!editor.canSubmit.get()`.
 *
 * -----------------------------------------------------------------------------
 * 6. Contenteditable
 * -----------------------------------------------------------------------------
 * Not the canonical path: selection mapping, newlines, and IME differ from a
 * plain textarea. If you use contenteditable, you own: extracting plain text,
 * mapping DOM ranges to code-unit offsets, and keeping `textBuffer` in sync.
 *
 * -----------------------------------------------------------------------------
 * Below: minimal non-DOM sketch showing subscribe + dispose only.
 */

import { subscribe } from "callbag-recharge/extra";
import { textEditor } from "callbag-recharge/patterns/textEditor";

const editor = textEditor({ name: "uiAdapterDemo", initial: "# Hello\n" });

// Example: push buffer state into a textarea on each DATA (Rx-style: no initial callback)
const stopContent = subscribe(editor.buffer.content, () => {
	// textarea.value = editor.buffer.content.get();
	// textarea.selectionStart = editor.buffer.cursor.start.get();
	// textarea.selectionEnd = editor.buffer.cursor.end.get();
});

editor.buffer.insert("world");
editor.commands.dispatch("undo");
stopContent();
editor.dispose();

console.log("text-editor-ui-adapter: contract documented; dispose OK");
