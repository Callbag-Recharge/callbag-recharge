import { describe, expect, it } from "vitest";
import { buildExtractionMessages, parseFacts } from "../../../ai/agentMemory/extraction";

describe("parseFacts", () => {
	it("parses valid JSON array", () => {
		const input = JSON.stringify([
			{ content: "User prefers TypeScript", importance: 0.8, tags: ["preference"] },
			{ content: "Building a state library", importance: 0.9, tags: ["project"] },
		]);
		const facts = parseFacts(input);
		expect(facts).toHaveLength(2);
		expect(facts[0].content).toBe("User prefers TypeScript");
		expect(facts[0].importance).toBe(0.8);
		expect(facts[0].tags).toEqual(["preference"]);
		expect(facts[1].content).toBe("Building a state library");
	});

	it("handles JSON wrapped in markdown code block", () => {
		const input =
			'```json\n[{"content": "Likes React", "importance": 0.7, "tags": ["technical"]}]\n```';
		const facts = parseFacts(input);
		expect(facts).toHaveLength(1);
		expect(facts[0].content).toBe("Likes React");
	});

	it("returns empty array for empty input", () => {
		expect(parseFacts("")).toEqual([]);
		expect(parseFacts("   ")).toEqual([]);
	});

	it("returns empty array for empty JSON array", () => {
		expect(parseFacts("[]")).toEqual([]);
	});

	it("defaults importance to 0.5 when missing", () => {
		const input = JSON.stringify([{ content: "A fact" }]);
		const facts = parseFacts(input);
		expect(facts[0].importance).toBe(0.5);
	});

	it("defaults tags to [] when missing", () => {
		const input = JSON.stringify([{ content: "A fact", importance: 0.5 }]);
		const facts = parseFacts(input);
		expect(facts[0].tags).toEqual([]);
	});

	it("clamps importance to 0-1 range", () => {
		const input = JSON.stringify([
			{ content: "High", importance: 5.0, tags: [] },
			{ content: "Low", importance: -1.0, tags: [] },
		]);
		const facts = parseFacts(input);
		expect(facts[0].importance).toBe(1);
		expect(facts[1].importance).toBe(0);
	});

	it("skips entries with empty content", () => {
		const input = JSON.stringify([
			{ content: "", importance: 0.5 },
			{ content: "Valid", importance: 0.5 },
		]);
		const facts = parseFacts(input);
		expect(facts).toHaveLength(1);
		expect(facts[0].content).toBe("Valid");
	});

	it("handles malformed JSON with line-by-line fallback", () => {
		const input =
			'{"content": "Fact one", "importance": 0.8, "tags": []}\n{"content": "Fact two", "importance": 0.6, "tags": []}';
		const facts = parseFacts(input);
		expect(facts).toHaveLength(2);
		expect(facts[0].content).toBe("Fact one");
		expect(facts[1].content).toBe("Fact two");
	});

	it("filters non-string tags", () => {
		const input = JSON.stringify([{ content: "Fact", tags: ["valid", 42, null, "also-valid"] }]);
		const facts = parseFacts(input);
		expect(facts[0].tags).toEqual(["valid", "also-valid"]);
	});

	it("handles completely unparseable output", () => {
		expect(parseFacts("This is not JSON at all")).toEqual([]);
	});
});

describe("buildExtractionMessages", () => {
	it("builds messages with default prompt", () => {
		const messages = [
			{ role: "user", content: "I love Python" },
			{ role: "assistant", content: "Great choice!" },
		];
		const result = buildExtractionMessages(messages);
		expect(result).toHaveLength(2);
		expect(result[0].role).toBe("system");
		expect(result[0].content).toContain("memory extraction system");
		expect(result[1].role).toBe("user");
		expect(result[1].content).toContain("user: I love Python");
		expect(result[1].content).toContain("assistant: Great choice!");
	});

	it("uses custom prompt when provided", () => {
		const messages = [{ role: "user", content: "Hello" }];
		const result = buildExtractionMessages(messages, "Custom prompt");
		expect(result[0].content).toBe("Custom prompt");
	});
});
