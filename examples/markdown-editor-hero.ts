/**
 * H1: Markdown Editor — Hero App store layer
 *
 * Split-pane editor: CodeMirror left, live Markdown preview right.
 * Toolbar: undo/redo, word count, cursor position, auto-save indicator.
 *
 * All library logic lives here; the Vue component is UI-only.
 *
 * Demonstrates: textEditor pattern, checkpoint (auto-save), debounce,
 * derived (word count, cursor display), state (auto-save indicator).
 *
 * Run: pnpm exec tsx --tsconfig tsconfig.examples.json examples/markdown-editor-hero.ts
 */

import type { Store } from "callbag-recharge";
import { derived, effect, pipe } from "callbag-recharge";
import { debounce } from "callbag-recharge/extra";
import type { TextEditorResult } from "callbag-recharge/patterns/textEditor";
import { textEditor } from "callbag-recharge/patterns/textEditor";
import type { CheckpointAdapter } from "callbag-recharge/utils";
import { checkpoint, memoryAdapter } from "callbag-recharge/utils";

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
	return out.join("\n");
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

	// --- Derived stats ---
	const wordCount = derived(
		[editor.buffer.content],
		() => {
			const text = editor.buffer.content.get().trim();
			if (text.length === 0) return 0;
			return text.split(/\s+/).length;
		},
		{ name: "h1.wordCount" },
	);

	const charCount = derived([editor.buffer.content], () => editor.buffer.content.get().length, {
		name: "h1.charCount",
	});

	const lineCount = derived(
		[editor.buffer.content],
		() => editor.buffer.content.get().split("\n").length,
		{ name: "h1.lineCount" },
	);

	const cursorDisplay = derived(
		[editor.buffer.cursor.start, editor.buffer.content],
		() => {
			const pos = editor.buffer.cursor.start.get();
			const text = editor.buffer.content.get();
			const before = text.slice(0, pos);
			const line = before.split("\n").length;
			const lastNewline = before.lastIndexOf("\n");
			const col = pos - lastNewline;
			return `Ln ${line}, Col ${col}`;
		},
		{ name: "h1.cursorDisplay" },
	);

	// --- Auto-save via debounce + checkpoint ---
	const debouncedContent = pipe(editor.buffer.content, debounce(autoSaveMs));

	const save = checkpoint<string>("h1:autosave", adapter, { name: "h1.checkpoint" });
	const checkpointed = save(debouncedContent);

	// Single derived: glitch-free status with a fixed priority order.
	// Priority: saved > saving > unsaved. "saved" when the checkpoint has
	// persisted the latest debounced value AND the buffer is not dirty again.
	const autoSaveStatus = derived(
		[editor.buffer.dirty, debouncedContent, checkpointed],
		(): "saved" | "saving" | "unsaved" => {
			if (checkpointed.get() !== undefined && !editor.buffer.dirty.get()) return "saved";
			if (debouncedContent.get() !== undefined) return "saving";
			if (editor.buffer.dirty.get()) return "unsaved";
			return "saved";
		},
		{ name: "h1.autoSaveStatus" },
	);

	// Side-effect: mark buffer clean after each successful checkpoint persist.
	const disposeClean = effect([checkpointed], () => {
		if (checkpointed.get() !== undefined) {
			editor.buffer.markClean();
		}
	});

	// --- Dispose ---
	function dispose(): void {
		disposeClean();
		checkpointed.clear();
		editor.dispose();
	}

	return {
		editor,
		wordCount,
		charCount,
		lineCount,
		cursorDisplay,
		autoSaveStatus,
		debouncedContent,
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
