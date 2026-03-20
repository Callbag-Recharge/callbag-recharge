import { describe, expect, it } from "vitest";
import { Inspector } from "../../../core/inspector";
import { textBuffer } from "../../../patterns/textBuffer";

describe("textBuffer", () => {
	it("inserts text at cursor", () => {
		const tb = textBuffer("abc");
		tb.cursor.collapse(1);
		tb.insert("X");
		expect(tb.content.get()).toBe("aXbc");
		expect(tb.cursor.start.get()).toBe(2);
		expect(tb.cursor.end.get()).toBe(2);
	});

	it("replaces selection with inserted text", () => {
		const tb = textBuffer("hello world");
		tb.cursor.select(6, 11);
		tb.insert("friend");
		expect(tb.content.get()).toBe("hello friend");
	});

	it("supports backward and forward delete", () => {
		const tb = textBuffer("abcd");
		tb.cursor.collapse(2);
		tb.delete();
		expect(tb.content.get()).toBe("acd");

		const tb2 = textBuffer("abcd");
		tb2.cursor.collapse(1);
		tb2.delete("forward");
		expect(tb2.content.get()).toBe("acd");
	});

	it("tracks selectedText reactively", () => {
		const tb = textBuffer("abcdef");
		tb.cursor.select(1, 4);
		expect(tb.selectedText.get()).toBe("bcd");
		tb.cursor.select(4, 1);
		expect(tb.selectedText.get()).toBe("bcd");
	});

	it("supports undo/redo through history", () => {
		const tb = textBuffer("x");
		tb.insert("a");
		tb.insert("b");
		expect(tb.content.get()).toBe("xab");
		tb.history.undo();
		expect(tb.content.get()).toBe("xa");
		tb.history.redo();
		expect(tb.content.get()).toBe("xab");
	});

	it("dirty becomes false after markClean", () => {
		const tb = textBuffer("init");
		expect(tb.dirty.get()).toBe(false);
		tb.replaceAll("next");
		expect(tb.dirty.get()).toBe(true);
		tb.markClean();
		expect(tb.dirty.get()).toBe(false);
	});

	it("emits DIRTY before DATA for edit operations", () => {
		const tb = textBuffer("abc");
		const obs = Inspector.observe(tb.content);
		tb.insert("x");
		expect(obs.dirtyCount).toBeGreaterThanOrEqual(1);
		expect(obs.values[obs.values.length - 1]).toBe("abcx");
		obs.dispose();
	});

	it("equal replaceAll is suppressible when equals is configured", () => {
		const tb = textBuffer("abc", { equals: Object.is });
		tb.cursor.select(0, 2);
		const obs = Inspector.observe(tb.content);
		const valueCountBefore = obs.values.length;

		tb.replaceAll("abc");

		expect(tb.content.get()).toBe("abc");
		expect(obs.values.length).toBe(valueCountBefore);
		obs.dispose();
	});

	it("markClean baseline update suppresses dirty churn when value unchanged", () => {
		const tb = textBuffer("start");
		tb.replaceAll("next");
		expect(tb.dirty.get()).toBe(true);
		tb.markClean();
		expect(tb.dirty.get()).toBe(false);

		tb.replaceAll("next");
		expect(tb.dirty.get()).toBe(false);
	});
});
