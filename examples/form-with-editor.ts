/**
 * Form field + text editor — composed validation and submit
 *
 * Demonstrates: `formField` for a title (sync validation) and `textEditor` for body
 * (length + submit lifecycle). Combined readiness via `derived`, reset/cancel, cleanup.
 *
 * Run: npx tsx examples/form-with-editor.ts
 * From this repo: pnpm exec tsx --tsconfig tsconfig.examples.json examples/form-with-editor.ts
 */
import { derived } from "callbag-recharge";
import { formField } from "callbag-recharge/patterns/formField";
import { textEditor } from "callbag-recharge/patterns/textEditor";

const titleField = formField("", {
	name: "postTitle",
	validate: (v) => (v.trim().length > 0 ? true : "Title is required"),
});

const bodyEditor = textEditor({
	name: "postBody",
	initial: "",
	placeholder: "Write the post…",
	maxLength: 500,
	onSubmit: async (body) => {
		const title = titleField.value.get();
		console.log("[onSubmit] publish:", { title, bodyLen: body.length });
	},
	onCancel: () => {
		console.log("[onCancel] discarded draft");
	},
});

/** Whole form can submit only when title is valid and editor allows submit. */
const canPublish = derived([titleField.valid, bodyEditor.canSubmit], () => {
	return titleField.valid.get() && bodyEditor.canSubmit.get();
});

function logForm(label: string): void {
	console.log(`\n--- ${label} ---`);
	console.log("title:", JSON.stringify(titleField.value.get()));
	console.log(
		"title valid / error:",
		titleField.valid.get(),
		JSON.stringify(titleField.error.get()),
	);
	console.log("body dirty:", bodyEditor.buffer.dirty.get());
	console.log("body canSubmit:", bodyEditor.canSubmit.get());
	console.log("canPublish:", canPublish.get());
}

async function tryPublish(): Promise<void> {
	if (!canPublish.get()) {
		console.log("[tryPublish] blocked");
		return;
	}
	await bodyEditor.submit();
}

logForm("empty");

titleField.set("  ");
logForm("title whitespace only (invalid)");

titleField.set("My post");
bodyEditor.buffer.insert("Short body.");
logForm("valid title + body");

await tryPublish();
logForm("after publish (body marked clean if submit succeeded)");

bodyEditor.buffer.insert(" Addendum.");
logForm("edit after publish (body dirty again)");

console.log("\n--- cancel (callback only) ---");
bodyEditor.cancel();

console.log("\n--- reset title + clear body ---");
titleField.reset();
bodyEditor.buffer.replaceAll("");
logForm("after reset");

titleField.dispose();
bodyEditor.dispose();
console.log("\n--- done ---");
