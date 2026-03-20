/**
 * Markdown-style editor — preview transform, commands, validation
 *
 * Demonstrates: `markdown` preview function, multiline commands (heading, list, code),
 * `maxLength` validation, and logging both source `buffer.content` and `preview`.
 *
 * Run: npx tsx examples/markdown-editor.ts
 * From this repo: pnpm exec tsx --tsconfig tsconfig.examples.json examples/markdown-editor.ts
 */
import type { TextEditorResult } from "callbag-recharge/patterns/textEditor";
import { textEditor } from "callbag-recharge/patterns/textEditor";

/** Tiny preview — no external parser; enough to show the reactive preview pipeline. */
function markdownPreview(md: string): string {
	const lines = md.split("\n");
	const out: string[] = [];
	for (const line of lines) {
		const h3 = /^### (.*)$/.exec(line);
		const h2 = /^## (.*)$/.exec(line);
		const h1 = /^# (.*)$/.exec(line);
		if (h3) {
			out.push(`<h3>${escapeHtml(h3[1])}</h3>`);
			continue;
		}
		if (h2) {
			out.push(`<h2>${escapeHtml(h2[1])}</h2>`);
			continue;
		}
		if (h1) {
			out.push(`<h1>${escapeHtml(h1[1])}</h1>`);
			continue;
		}
		if (/^-\s+/.test(line)) {
			out.push(`<li>${escapeHtml(line.replace(/^-\s+/, ""))}</li>`);
			continue;
		}
		if (/^\d+\.\s+/.test(line)) {
			out.push(`<li>${escapeHtml(line.replace(/^\d+\.\s+/, ""))}</li>`);
			continue;
		}
		out.push(`<p>${escapeInline(line)}</p>`);
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
		.replace(/`([^`]+)`/g, "<code>$1</code>");
}

function logPair(label: string, editor: TextEditorResult): void {
	console.log(`\n--- ${label} ---`);
	console.log("markdown:\n", editor.buffer.content.get());
	console.log("preview:\n", editor.preview.get());
	console.log("valid:", editor.valid.get(), "| error:", JSON.stringify(editor.error.get()));
}

const editor = textEditor({
	name: "markdownDemo",
	initial: "",
	markdown: markdownPreview,
	maxLength: 400,
	validators: [(v) => (v.includes("TODO") ? "Remove TODO before publish" : true)],
	onSubmit: async (content) => {
		console.log("[onSubmit] saved draft, length:", content.length);
	},
});

// Baseline: headings + inline emphasis (preview updates via derived)
editor.buffer.replaceAll("# Demo\n\nUse **bold** and `code`.\n");
logPair("initial", editor);

// Multiline list: select the paragraph line, turn into bullets (one line → one bullet)
const value = editor.buffer.content.get();
const listStart = value.indexOf("Use **bold**");
const listEnd = value.length;
editor.buffer.cursor.select(listStart, listEnd);
editor.commands.dispatch("list", { ordered: false });
logPair("after bullet list on selection", editor);

// Inline code around a single word
const v2 = editor.buffer.content.get();
const w = "**bold**";
const at = v2.indexOf(w);
if (at >= 0) {
	editor.buffer.cursor.select(at, at + w.length);
	editor.commands.dispatch("code", { block: false });
}
logPair("after inline code on **bold**", editor);

// Custom validator: forbidden TODO
editor.buffer.cursor.collapse(editor.buffer.content.get().length);
editor.buffer.insert("\nTODO: fix me\n");
logPair("with TODO (expect custom error)", editor);

editor.buffer.history.undo();
logPair("after undo TODO line", editor);

// maxLength: append past limit
const room = 400 - editor.buffer.content.get().length;
editor.buffer.insert("x".repeat(Math.max(0, room + 50)));
logPair("after overflow (expect maxLength error)", editor);

editor.buffer.history.undo();
logPair("after undo overflow", editor);

await editor.submit();
logPair("after submit (clean)", editor);

editor.dispose();
console.log("\n--- done ---");
