import { describe, expect, it, vi } from "vitest";
import { createMarkdownEditorHero, markdownToHtml } from "../../../examples/markdown-editor-hero";
import { Inspector } from "../../core/inspector";

describe("H1: Markdown Editor Hero — store layer", () => {
	// -----------------------------------------------------------------------
	// Markdown preview
	// -----------------------------------------------------------------------
	describe("markdown preview", () => {
		it("renders headings h1/h2/h3", () => {
			const html = markdownToHtml("# H1\n## H2\n### H3");
			expect(html).toContain("<h1>H1</h1>");
			expect(html).toContain("<h2>H2</h2>");
			expect(html).toContain("<h3>H3</h3>");
		});

		it("renders bold, italic, and inline code", () => {
			const html = markdownToHtml("Use **bold** and *italic* and `code`.");
			expect(html).toContain("<strong>bold</strong>");
			expect(html).toContain("<em>italic</em>");
			expect(html).toContain("<code>code</code>");
		});

		it("renders unordered and ordered lists", () => {
			const html = markdownToHtml("- apple\n- banana\n1. first\n2. second");
			expect(html).toContain("<li>apple</li>");
			expect(html).toContain("<li>banana</li>");
			expect(html).toContain("<li>first</li>");
			expect(html).toContain("<li>second</li>");
		});

		it("renders code blocks", () => {
			const html = markdownToHtml("```\nconst x = 1;\n```");
			expect(html).toContain("<pre><code>");
			expect(html).toContain("const x = 1;");
			expect(html).toContain("</code></pre>");
		});

		it("escapes HTML in headings and paragraphs", () => {
			const html = markdownToHtml("# <script>alert('xss')</script>");
			expect(html).not.toContain("<script>");
			expect(html).toContain("&lt;script&gt;");
		});

		it("renders links", () => {
			const html = markdownToHtml("Visit [Google](https://google.com).");
			expect(html).toContain('<a href="https://google.com">Google</a>');
		});
	});

	// -----------------------------------------------------------------------
	// Core editor integration
	// -----------------------------------------------------------------------
	describe("editor basics", () => {
		it("creates with empty initial content", () => {
			const hero = createMarkdownEditorHero();
			expect(hero.editor.buffer.content.get()).toBe("");
			expect(hero.wordCount.get()).toBe(0);
			expect(hero.charCount.get()).toBe(0);
			expect(hero.lineCount.get()).toBe(1);
			hero.dispose();
		});

		it("creates with provided initial content", () => {
			const hero = createMarkdownEditorHero({ initial: "Hello world" });
			expect(hero.editor.buffer.content.get()).toBe("Hello world");
			expect(hero.wordCount.get()).toBe(2);
			expect(hero.charCount.get()).toBe(11);
			hero.dispose();
		});

		it("preview updates reactively on content change", () => {
			const hero = createMarkdownEditorHero();
			const obs = Inspector.observe(hero.editor.preview);

			hero.editor.buffer.replaceAll("# Title");
			expect(hero.editor.preview.get()).toContain("<h1>Title</h1>");

			hero.editor.buffer.replaceAll("**bold**");
			expect(hero.editor.preview.get()).toContain("<strong>bold</strong>");

			obs.dispose();
			hero.dispose();
		});
	});

	// -----------------------------------------------------------------------
	// Undo/redo round-trips
	// -----------------------------------------------------------------------
	describe("undo/redo", () => {
		it("undo restores previous content exactly", () => {
			const hero = createMarkdownEditorHero({ initial: "original" });
			const obs = Inspector.observe(hero.editor.buffer.content);

			hero.editor.buffer.replaceAll("modified");
			expect(hero.editor.buffer.content.get()).toBe("modified");

			hero.editor.buffer.history.undo();
			expect(hero.editor.buffer.content.get()).toBe("original");

			obs.dispose();
			hero.dispose();
		});

		it("redo restores undone content", () => {
			const hero = createMarkdownEditorHero({ initial: "original" });

			hero.editor.buffer.replaceAll("modified");
			hero.editor.buffer.history.undo();
			hero.editor.buffer.history.redo();
			expect(hero.editor.buffer.content.get()).toBe("modified");

			hero.dispose();
		});

		it("multiple undo/redo round-trips preserve content", () => {
			const hero = createMarkdownEditorHero({ initial: "v1" });

			hero.editor.buffer.replaceAll("v2");
			hero.editor.buffer.replaceAll("v3");

			hero.editor.buffer.history.undo();
			expect(hero.editor.buffer.content.get()).toBe("v2");

			hero.editor.buffer.history.undo();
			expect(hero.editor.buffer.content.get()).toBe("v1");

			hero.editor.buffer.history.redo();
			expect(hero.editor.buffer.content.get()).toBe("v2");

			hero.dispose();
		});

		it("undo/redo restores content correctly through multiple edits", () => {
			const hero = createMarkdownEditorHero({ initial: "abc" });

			hero.editor.buffer.replaceAll("hello");
			expect(hero.editor.buffer.content.get()).toBe("hello");

			hero.editor.buffer.replaceAll("hi");
			expect(hero.editor.buffer.content.get()).toBe("hi");

			// Undo restores previous content
			hero.editor.buffer.history.undo();
			expect(hero.editor.buffer.content.get()).toBe("hello");

			// Redo restores forward
			hero.editor.buffer.history.redo();
			expect(hero.editor.buffer.content.get()).toBe("hi");

			hero.dispose();
		});
	});

	// -----------------------------------------------------------------------
	// Word count
	// -----------------------------------------------------------------------
	describe("word count", () => {
		it("updates synchronously with text changes", () => {
			const hero = createMarkdownEditorHero();
			const obs = Inspector.observe(hero.wordCount);

			hero.editor.buffer.replaceAll("one two three");
			expect(hero.wordCount.get()).toBe(3);

			hero.editor.buffer.replaceAll("one");
			expect(hero.wordCount.get()).toBe(1);

			hero.editor.buffer.replaceAll("");
			expect(hero.wordCount.get()).toBe(0);

			obs.dispose();
			hero.dispose();
		});

		it("handles multiline content", () => {
			const hero = createMarkdownEditorHero();
			hero.editor.buffer.replaceAll("line one\nline two\nline three");
			expect(hero.wordCount.get()).toBe(6);
			hero.dispose();
		});
	});

	// -----------------------------------------------------------------------
	// Character and line count
	// -----------------------------------------------------------------------
	describe("char and line count", () => {
		it("charCount matches content length", () => {
			const hero = createMarkdownEditorHero();
			hero.editor.buffer.replaceAll("hello");
			expect(hero.charCount.get()).toBe(5);
			hero.dispose();
		});

		it("lineCount matches newline count + 1", () => {
			const hero = createMarkdownEditorHero();
			hero.editor.buffer.replaceAll("a\nb\nc");
			expect(hero.lineCount.get()).toBe(3);
			hero.dispose();
		});
	});

	// -----------------------------------------------------------------------
	// Cursor display
	// -----------------------------------------------------------------------
	describe("cursor display", () => {
		it("shows Ln 1, Col 1 at start", () => {
			const hero = createMarkdownEditorHero({ initial: "abc" });
			hero.editor.buffer.cursor.collapse(0);
			expect(hero.cursorDisplay.get()).toBe("Ln 1, Col 1");
			hero.dispose();
		});

		it("updates on cursor move", () => {
			const hero = createMarkdownEditorHero({ initial: "abc\ndef\nghi" });
			// Position at start of line 2 (after "abc\n" = position 4)
			hero.editor.buffer.cursor.collapse(4);
			expect(hero.cursorDisplay.get()).toBe("Ln 2, Col 1");

			// Position in middle of line 2 (after "abc\nde" = position 6)
			hero.editor.buffer.cursor.collapse(6);
			expect(hero.cursorDisplay.get()).toBe("Ln 2, Col 3");
			hero.dispose();
		});
	});

	// -----------------------------------------------------------------------
	// Validation
	// -----------------------------------------------------------------------
	describe("validation", () => {
		it("maxLength triggers validation error", () => {
			const hero = createMarkdownEditorHero({ maxLength: 10 });
			hero.editor.buffer.replaceAll("x".repeat(15));
			expect(hero.editor.valid.get()).toBe(false);
			expect(hero.editor.error.get()).toContain("Maximum length");
			hero.dispose();
		});

		it("custom validator triggers error", () => {
			const hero = createMarkdownEditorHero({
				validators: [(v) => (v.includes("TODO") ? "Remove TODOs" : true)],
			});
			hero.editor.buffer.replaceAll("Fix TODO item");
			expect(hero.editor.valid.get()).toBe(false);
			expect(hero.editor.error.get()).toBe("Remove TODOs");
			hero.dispose();
		});

		it("valid content passes validation", () => {
			const hero = createMarkdownEditorHero({ maxLength: 100 });
			hero.editor.buffer.replaceAll("short text");
			expect(hero.editor.valid.get()).toBe(true);
			expect(hero.editor.error.get()).toBe("");
			hero.dispose();
		});
	});

	// -----------------------------------------------------------------------
	// Auto-save (debounce + checkpoint)
	// -----------------------------------------------------------------------
	describe("auto-save", () => {
		it("auto-save status starts as saved", () => {
			const hero = createMarkdownEditorHero();
			expect(hero.autoSaveStatus.get()).toBe("saved");
			hero.dispose();
		});

		it("dirty edit sets status to unsaved", () => {
			const hero = createMarkdownEditorHero();
			const obs = Inspector.observe(hero.autoSaveStatus);

			hero.editor.buffer.replaceAll("changed");
			expect(hero.autoSaveStatus.get()).toBe("unsaved");

			obs.dispose();
			hero.dispose();
		});

		it("debounced content fires after quiet period", async () => {
			vi.useFakeTimers();
			const hero = createMarkdownEditorHero({ autoSaveMs: 100 });
			const obs = Inspector.observe(hero.debouncedContent);

			hero.editor.buffer.replaceAll("typing...");

			// Not yet debounced
			expect(obs.values.filter((v) => v !== undefined)).toHaveLength(0);

			// Advance past debounce window
			vi.advanceTimersByTime(150);
			expect(obs.values).toContain("typing...");

			obs.dispose();
			hero.dispose();
			vi.useRealTimers();
		});

		it("checkpoint save/restore cycle with memory adapter", async () => {
			vi.useFakeTimers();
			const hero = createMarkdownEditorHero({ autoSaveMs: 50 });
			const obs = Inspector.observe(hero.autoSaveStatus);

			hero.editor.buffer.replaceAll("persisted content");
			vi.advanceTimersByTime(100);

			// After debounce fires and checkpoint saves, status should be "saved"
			expect(hero.autoSaveStatus.get()).toBe("saved");

			obs.dispose();
			hero.dispose();
			vi.useRealTimers();
		});
	});

	// -----------------------------------------------------------------------
	// Markdown commands
	// -----------------------------------------------------------------------
	describe("commands", () => {
		it("heading command wraps selected text", () => {
			const hero = createMarkdownEditorHero({ initial: "Title" });
			hero.editor.buffer.cursor.select(0, 5);
			hero.editor.commands.dispatch("heading", { level: 1 });
			expect(hero.editor.buffer.content.get()).toContain("# Title");
			hero.dispose();
		});

		it("undo command reverses last edit", () => {
			const hero = createMarkdownEditorHero({ initial: "original" });
			hero.editor.buffer.replaceAll("changed");
			hero.editor.commands.dispatch("undo", undefined as any);
			expect(hero.editor.buffer.content.get()).toBe("original");
			hero.dispose();
		});

		it("redo command restores undone edit", () => {
			const hero = createMarkdownEditorHero({ initial: "original" });
			hero.editor.buffer.replaceAll("changed");
			hero.editor.commands.dispatch("undo", undefined as any);
			hero.editor.commands.dispatch("redo", undefined as any);
			expect(hero.editor.buffer.content.get()).toBe("changed");
			hero.dispose();
		});
	});

	// -----------------------------------------------------------------------
	// Dispose
	// -----------------------------------------------------------------------
	describe("dispose", () => {
		it("dispose cleans up without errors", () => {
			const hero = createMarkdownEditorHero({ initial: "test" });
			expect(() => hero.dispose()).not.toThrow();
		});
	});
});
