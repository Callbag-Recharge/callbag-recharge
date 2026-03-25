import { describe, expect, it } from "vitest";
import { systemPromptBuilder } from "../../../ai/systemPromptBuilder";
import { Inspector } from "../../../core/inspector";
import { state } from "../../../core/state";

describe("systemPromptBuilder", () => {
	it("assembles sections into a formatted prompt", () => {
		const rules = state("You are a helpful assistant.");
		const docs = state("get() returns the current value.");

		const prompt = systemPromptBuilder({
			sections: [
				{ name: "Rules", content: rules },
				{ name: "Docs", content: docs },
			],
		});

		expect(prompt.get()).toBe(
			"## Rules\nYou are a helpful assistant.\n\n## Docs\nget() returns the current value.",
		);
		prompt.destroy();
	});

	it("omits sections with empty content", () => {
		const rules = state("Be concise.");
		const docs = state("");
		const memory = state("User likes brevity.");

		const prompt = systemPromptBuilder({
			sections: [
				{ name: "Rules", content: rules },
				{ name: "Docs", content: docs },
				{ name: "Memory", content: memory },
			],
		});

		expect(prompt.get()).toBe("## Rules\nBe concise.\n\n## Memory\nUser likes brevity.");
		prompt.destroy();
	});

	it("reactively updates when a section changes", () => {
		const rules = state("Rule 1.");
		const docs = state("Doc content.");

		const prompt = systemPromptBuilder({
			sections: [
				{ name: "Rules", content: rules },
				{ name: "Docs", content: docs },
			],
		});

		const observed = Inspector.observe(prompt);

		rules.set("Rule 2.");
		expect(prompt.get()).toBe("## Rules\nRule 2.\n\n## Docs\nDoc content.");
		expect(observed.values).toContain("## Rules\nRule 2.\n\n## Docs\nDoc content.");

		observed.dispose();
		prompt.destroy();
	});

	it("truncates sections with per-section maxTokens", () => {
		// estimateTokens: Math.ceil(words * 1.3)
		// truncateToTokens accumulates 1.3 per word, stops when > maxTokens
		// 3 words = 3.9 tokens, 4 words = 5.2 tokens
		// maxTokens: 5 → should keep 3 words (3.9 ≤ 5), truncate at 4th (5.2 > 5)
		const longContent = state("one two three four five six seven eight nine ten");

		const prompt = systemPromptBuilder({
			sections: [{ name: "Test", content: longContent, maxTokens: 5 }],
		});

		const result = prompt.get();
		const contentWords = result.replace("## Test\n", "").split(/\s+/).filter(Boolean);
		expect(contentWords).toEqual(["one", "two", "three"]);
		prompt.destroy();
	});

	it("estimateTokens and truncateToTokens use consistent math", () => {
		// 7 words → estimateTokens = ceil(7 * 1.3) = ceil(9.1) = 10
		// truncateToTokens with maxTokens: 10: 7 * 1.3 accumulated = 9.1 ≤ 10 → keeps all 7
		const sevenWords = state("a b c d e f g");

		const prompt = systemPromptBuilder({
			sections: [{ name: "S", content: sevenWords, maxTokens: 10 }],
		});

		const contentWords = prompt.get().replace("## S\n", "").split(/\s+/).filter(Boolean);
		expect(contentWords.length).toBe(7);
		prompt.destroy();
	});

	it("enforces maxTotalTokens by removing last sections first", () => {
		const wordy = (n: number) => Array(n).fill("word").join(" ");
		const s1 = state(wordy(50)); // ~65 tokens + header
		const s2 = state(wordy(50));
		const s3 = state(wordy(50));

		const prompt = systemPromptBuilder({
			sections: [
				{ name: "Priority", content: s1 },
				{ name: "Normal", content: s2 },
				{ name: "Low", content: s3 },
			],
			maxTotalTokens: 80,
		});

		const result = prompt.get();
		// Priority (first) should survive; Low (last) should be removed first
		expect(result).toContain("## Priority");
		expect(result).not.toContain("## Low");
		prompt.destroy();
	});

	it("returns empty string when all sections are empty", () => {
		const prompt = systemPromptBuilder({
			sections: [
				{ name: "A", content: state("") },
				{ name: "B", content: state("") },
			],
		});

		expect(prompt.get()).toBe("");
		prompt.destroy();
	});

	it("reacts when a section goes from empty to populated", () => {
		const docs = state("");
		const prompt = systemPromptBuilder({
			sections: [{ name: "Docs", content: docs }],
		});

		expect(prompt.get()).toBe("");

		docs.set("New documentation.");
		expect(prompt.get()).toBe("## Docs\nNew documentation.");
		prompt.destroy();
	});

	it("is subscribable as a Store<string>", () => {
		const rules = state("Hello.");
		const prompt = systemPromptBuilder({
			sections: [{ name: "Rules", content: rules }],
		});

		const observed = Inspector.observe(prompt);

		rules.set("Updated.");

		expect(observed.values.length).toBeGreaterThanOrEqual(1);
		expect(observed.values[observed.values.length - 1]).toBe("## Rules\nUpdated.");

		observed.dispose();
		prompt.destroy();
	});

	it("omits section when maxTokens is 0", () => {
		const prompt = systemPromptBuilder({
			sections: [
				{ name: "A", content: state("some content"), maxTokens: 0 },
				{ name: "B", content: state("visible") },
			],
		});

		expect(prompt.get()).toBe("## B\nvisible");
		prompt.destroy();
	});

	it("handles empty sections array", () => {
		const prompt = systemPromptBuilder({ sections: [] });
		expect(prompt.get()).toBe("");
		prompt.destroy();
	});

	it("handles single section", () => {
		const content = state("Only section.");
		const prompt = systemPromptBuilder({
			sections: [{ name: "Solo", content }],
		});

		expect(prompt.get()).toBe("## Solo\nOnly section.");
		prompt.destroy();
	});
});
