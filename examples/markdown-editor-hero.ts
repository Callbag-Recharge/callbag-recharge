/**
 * H1: Markdown Editor — Hero App store layer
 *
 * Split-pane editor: CodeMirror left, live Markdown preview right.
 * Toolbar: undo/redo, word count, cursor position, auto-save indicator.
 *
 * All library logic lives here; the Vue component is UI-only.
 *
 * Demonstrates: textEditor pattern, contentStats, cursorInfo, autoSave (utils).
 * Import constraint: utils+ only (no raw/core/extra).
 *
 * Run: pnpm exec tsx --tsconfig tsconfig.examples.json examples/markdown-editor-hero.ts
 */

import type { TextEditorResult } from "callbag-recharge/patterns/textEditor";
import { textEditor } from "callbag-recharge/patterns/textEditor";
import type {
	AutoSaveResult,
	CheckpointAdapter,
	ContentStats,
	CursorInfo,
	Store,
} from "callbag-recharge/utils";
import { autoSave, contentStats, cursorInfo, memoryAdapter } from "callbag-recharge/utils";

// ---------------------------------------------------------------------------
// Markdown preview (lightweight — no external parser)
// ---------------------------------------------------------------------------
export function markdownToHtml(md: string): string {
	const lines = md.split("\n");
	const out: string[] = [];
	let inCodeBlock = false;

	for (const line of lines) {
		if (/^```/.test(line)) {
			inCodeBlock = !inCodeBlock;
			out.push(inCodeBlock ? "<pre><code>" : "</code></pre>");
			continue;
		}
		if (inCodeBlock) {
			out.push(escapeHtml(line));
			continue;
		}

		const h3 = /^### (.*)$/.exec(line);
		const h2 = /^## (.*)$/.exec(line);
		const h1 = /^# (.*)$/.exec(line);
		if (h3) {
			out.push(`<h3>${escapeHtml(h3[1])}</h3>`);
		} else if (h2) {
			out.push(`<h2>${escapeHtml(h2[1])}</h2>`);
		} else if (h1) {
			out.push(`<h1>${escapeHtml(h1[1])}</h1>`);
		} else if (/^-\s+/.test(line)) {
			out.push(`<li>${escapeInline(line.replace(/^-\s+/, ""))}</li>`);
		} else if (/^\d+\.\s+/.test(line)) {
			out.push(`<li>${escapeInline(line.replace(/^\d+\.\s+/, ""))}</li>`);
		} else if (line.trim() === "") {
			out.push("<br>");
		} else {
			out.push(`<p>${escapeInline(line)}</p>`);
		}
	}
	// Avoid an artificial blank first/last line inside fenced code blocks.
	return out
		.join("\n")
		.replace(/<pre><code>\n/g, "<pre><code>")
		.replace(/\n<\/code><\/pre>/g, "</code></pre>");
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function escapeInline(s: string): string {
	return escapeHtml(s)
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/\*(.+?)\*/g, "<em>$1</em>")
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

// ---------------------------------------------------------------------------
// Store factory — everything the Vue component needs
// ---------------------------------------------------------------------------
export interface MarkdownEditorHero {
	/** Core text editor (buffer, commands, validation, preview). */
	editor: TextEditorResult;
	/** Word count derived from content. */
	wordCount: Store<number>;
	/** Character count derived from content. */
	charCount: Store<number>;
	/** Line count derived from content. */
	lineCount: Store<number>;
	/** Cursor display string e.g. "Ln 3, Col 12". */
	cursorDisplay: Store<string>;
	/** Auto-save status: "saved" | "saving" | "unsaved". */
	autoSaveStatus: Store<"saved" | "saving" | "unsaved">;
	/** Debounced content for auto-save (fires after 1s quiet). */
	debouncedContent: Store<string | undefined>;
	/** Content stats (word/char/line count). */
	stats: ContentStats;
	/** Cursor info (line/column/display). */
	cursor: CursorInfo;
	/** Auto-save result (debouncedContent, checkpointed, status). */
	save: AutoSaveResult<string>;
	/** Tear down everything. */
	dispose(): void;
}

export interface MarkdownEditorHeroOpts {
	/** Initial markdown content. */
	initial?: string;
	/** Max content length (characters). */
	maxLength?: number;
	/** Auto-save debounce interval in ms (default: 1000). */
	autoSaveMs?: number;
	/** Checkpoint adapter for persistence (default: memoryAdapter). */
	adapter?: CheckpointAdapter;
	/** Custom validators. */
	validators?: ((v: string) => string | true)[];
}

export function createMarkdownEditorHero(opts?: MarkdownEditorHeroOpts): MarkdownEditorHero {
	const adapter = opts?.adapter ?? memoryAdapter();
	const autoSaveMs = opts?.autoSaveMs ?? 1000;

	// --- Core editor ---
	const editor = textEditor({
		name: "h1",
		initial: opts?.initial ?? "",
		markdown: markdownToHtml,
		maxLength: opts?.maxLength,
		validators: opts?.validators,
	});

	// --- Derived stats (via contentStats utility) ---
	const stats = contentStats(editor.buffer.content, { name: "h1" });

	// --- Cursor info (via cursorInfo utility) ---
	const cursor = cursorInfo(editor.buffer.content, editor.buffer.cursor.start, { name: "h1" });

	// --- Auto-save (via autoSave utility) ---
	const save = autoSave(editor.buffer.content, editor.buffer.dirty, adapter, {
		debounceMs: autoSaveMs,
		checkpointId: "h1:autosave",
		name: "h1",
		markClean: () => editor.buffer.markClean(),
	});

	// --- Dispose ---
	function dispose(): void {
		save.dispose();
		stats.dispose();
		cursor.dispose();
		editor.dispose();
	}

	return {
		editor,
		wordCount: stats.wordCount,
		charCount: stats.charCount,
		lineCount: stats.lineCount,
		cursorDisplay: cursor.display,
		autoSaveStatus: save.status,
		debouncedContent: save.debouncedContent,
		stats,
		cursor,
		save,
		dispose,
	};
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
if (typeof process !== "undefined" && process.argv?.[1]?.includes("markdown-editor-hero")) {
	const hero = createMarkdownEditorHero({ maxLength: 500 });

	hero.editor.buffer.replaceAll(
		"# Hello World\n\nThis is a **bold** statement.\n\n- Item one\n- Item two\n",
	);

	console.log("preview:", hero.editor.preview.get());
	console.log("word count:", hero.wordCount.get());
	console.log("char count:", hero.charCount.get());
	console.log("line count:", hero.lineCount.get());
	console.log("cursor:", hero.cursorDisplay.get());
	console.log("valid:", hero.editor.valid.get());

	// Undo/redo round-trip
	const before = hero.editor.buffer.content.get();
	hero.editor.buffer.insert(" extra");
	hero.editor.buffer.history.undo();
	console.log("undo round-trip:", hero.editor.buffer.content.get() === before);

	hero.dispose();
	console.log("--- done ---");
}
