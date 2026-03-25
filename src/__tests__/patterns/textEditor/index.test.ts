import { describe, expect, it } from "vitest";
import { Inspector } from "../../../core/inspector";
import { textEditor } from "../../../patterns/textEditor";

describe("textEditor", () => {
	it("executes formatting commands", () => {
		const editor = textEditor({ initial: "hello" });
		editor.buffer.cursor.select(0, 5);
		editor.commands.dispatch("bold");
		expect(editor.buffer.content.get()).toBe("**hello**");
	});

	it("validates maxLength", () => {
		const editor = textEditor({ initial: "", maxLength: 5 });
		editor.buffer.replaceAll("123456");
		expect(editor.valid.get()).toBe(false);
		expect(editor.error.get()).toContain("Maximum length");
	});

	it("computes canSubmit from content, validation, and submitting", async () => {
		const editor = textEditor({ initial: "", maxLength: 10, onSubmit: async () => {} });
		expect(editor.canSubmit.get()).toBe(false);
		editor.buffer.replaceAll("ok");
		expect(editor.canSubmit.get()).toBe(true);
		editor.submit();
		await new Promise((r) => setTimeout(r, 0));
		expect(editor.submitting.get()).toBe(false);
	});

	it("runs submit callback and marks buffer clean", async () => {
		let submitted = "";
		const editor = textEditor({
			initial: "a",
			onSubmit: async (value) => {
				submitted = value;
			},
		});
		editor.buffer.replaceAll("updated");
		expect(editor.buffer.dirty.get()).toBe(true);
		editor.submit();
		await new Promise((r) => setTimeout(r, 0));
		expect(submitted).toBe("updated");
		expect(editor.buffer.dirty.get()).toBe(false);
	});

	it("updates preview with markdown formatter", () => {
		const editor = textEditor({
			initial: "hello",
			markdown: (content) => `<p>${content}</p>`,
		});
		expect(editor.preview.get()).toBe("<p>hello</p>");
		editor.buffer.replaceAll("next");
		expect(editor.preview.get()).toBe("<p>next</p>");
	});

	it("content protocol emits DIRTY then DATA on command mutation", () => {
		const editor = textEditor({ initial: "abc" });
		editor.buffer.cursor.select(0, 3);
		const obs = Inspector.observe(editor.buffer.content);
		editor.commands.dispatch("italic");
		expect(obs.dirtyCount).toBeGreaterThanOrEqual(1);
		expect(obs.values[obs.values.length - 1]).toBe("*abc*");
		obs.dispose();
	});

	it("submit rejection resets submitting state", async () => {
		const editor = textEditor({
			initial: "x",
			onSubmit: async () => {
				throw new Error("submit fail");
			},
		});
		editor.submit();
		await new Promise((r) => setTimeout(r, 0));
		expect(editor.submitting.get()).toBe(false);
	});

	it("async validator rejection surfaces as error and blocks submit", async () => {
		const editor = textEditor({
			initial: "",
			asyncValidators: [
				async () => {
					throw new Error("validator fail");
				},
			],
		});
		editor.buffer.replaceAll("hello");
		await new Promise((r) => setTimeout(r, 350));
		expect(editor.valid.get()).toBe(false);
		expect(editor.error.get()).toContain("validator fail");
		expect(editor.canSubmit.get()).toBe(false);
	});

	it("equal content writes keep canSubmit stable", () => {
		const editor = textEditor({ initial: "ok" });
		const before = editor.canSubmit.get();
		editor.buffer.replaceAll("ok");
		expect(editor.canSubmit.get()).toBe(before);
		expect(editor.buffer.content.get()).toBe("ok");
	});

	it("list command strips bullets when all lines are already bulleted", () => {
		const editor = textEditor({ initial: "- one\n- two" });
		const len = editor.buffer.content.get().length;
		editor.buffer.cursor.select(0, len);
		editor.commands.dispatch("list", { ordered: false });
		expect(editor.buffer.content.get()).toBe("one\ntwo");
	});

	it("heading command toggles off matching ATX level", () => {
		const editor = textEditor({ initial: "## Hi" });
		editor.buffer.cursor.select(0, editor.buffer.content.get().length);
		editor.commands.dispatch("heading", { level: 2 });
		expect(editor.buffer.content.get()).toBe("Hi");
	});

	it("code block command toggles fenced block", () => {
		const editor = textEditor({ initial: "x" });
		editor.buffer.cursor.select(0, 1);
		editor.commands.dispatch("code", { block: true });
		let v = editor.buffer.content.get();
		expect(v).toContain("```");
		editor.buffer.cursor.select(0, v.length);
		editor.commands.dispatch("code", { block: true });
		v = editor.buffer.content.get();
		expect(v).toBe("x");
	});

	it("submit rejection leaves buffer dirty", async () => {
		const editor = textEditor({
			initial: "body",
			onSubmit: async () => {
				throw new Error("network");
			},
		});
		editor.buffer.insert("!");
		expect(editor.buffer.dirty.get()).toBe(true);
		editor.submit();
		await new Promise((r) => setTimeout(r, 0));
		expect(editor.submitting.get()).toBe(false);
		expect(editor.buffer.dirty.get()).toBe(true);
	});

	it("inline code command toggles backticks off", () => {
		const editor = textEditor({ initial: "`hi`" });
		editor.buffer.cursor.select(0, 4);
		editor.commands.dispatch("code", { block: false });
		expect(editor.buffer.content.get()).toBe("hi");
	});
});
