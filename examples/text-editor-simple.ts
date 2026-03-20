/**
 * Headless text editor — textBuffer + commandBus + validation + submit/cancel
 *
 * Demonstrates: typing via buffer ops, markdown-style command (bold), dirty/canSubmit,
 * async submit hook, cancel, and dispose.
 *
 * Run: npx tsx examples/text-editor-simple.ts
 * From this repo: pnpm exec tsx --tsconfig tsconfig.examples.json examples/text-editor-simple.ts
 */
import { textEditor } from "callbag-recharge/patterns/textEditor";

const editor = textEditor({
	name: "simple",
	initial: "Hello ",
	placeholder: "Write something…",
	onSubmit: async (content) => {
		console.log("[onSubmit] posted:", JSON.stringify(content));
	},
	onCancel: () => {
		console.log("[onCancel] user cancelled");
	},
});

function logState(label: string): void {
	console.log(`\n--- ${label} ---`);
	console.log("content:", JSON.stringify(editor.buffer.content.get()));
	console.log("dirty:", editor.buffer.dirty.get());
	console.log("valid:", editor.valid.get(), "| error:", JSON.stringify(editor.error.get()));
	console.log("canSubmit:", editor.canSubmit.get());
}

editor.buffer.insert("world");
logState("after insert");

editor.buffer.cursor.select(0, 5);
editor.commands.dispatch("bold");
logState("after bold selection (Hello)");

// Add a second line (heading markup) — cursor at end after bold
editor.buffer.cursor.collapse(editor.buffer.content.get().length);
editor.buffer.insert("\n## Section\n");
logState("after newline + H2 line");

console.log("\n--- submit (should run onSubmit + mark clean) ---");
await editor.submit();
logState("after submit");

editor.buffer.insert("!");
logState("after edit post-submit (dirty again)");

console.log("\n--- cancel ---");
editor.cancel();

editor.dispose();
console.log("\n--- done ---");
