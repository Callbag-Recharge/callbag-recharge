import { describe, expect, it } from "vitest";
import {
	buildGraphExtractionMessages,
	parseGraphExtraction,
} from "../../../ai/agentMemory/graphExtraction";

describe("graphExtraction", () => {
	describe("parseGraphExtraction", () => {
		it("parses valid JSON with entities and relations", () => {
			const input = JSON.stringify({
				entities: [
					{ name: "Alice", content: "Software engineer", type: "person", tags: ["user"] },
					{ name: "TypeScript", content: "Language", type: "technology", tags: [] },
				],
				relations: [{ source: "Alice", target: "TypeScript", type: "uses", weight: 0.9 }],
			});

			const result = parseGraphExtraction(input);
			expect(result.entities).toHaveLength(2);
			expect(result.entities[0].name).toBe("Alice");
			expect(result.entities[1].type).toBe("technology");
			expect(result.relations).toHaveLength(1);
			expect(result.relations[0].source).toBe("Alice");
			expect(result.relations[0].weight).toBe(0.9);
		});

		it("returns empty for empty input", () => {
			const result = parseGraphExtraction("");
			expect(result.entities).toEqual([]);
			expect(result.relations).toEqual([]);
		});

		it("handles markdown-wrapped JSON", () => {
			const input =
				'```json\n{"entities": [{"name": "Bob", "content": "Dev", "type": "person", "tags": []}], "relations": []}\n```';
			const result = parseGraphExtraction(input);
			expect(result.entities).toHaveLength(1);
			expect(result.entities[0].name).toBe("Bob");
		});

		it("defaults missing entity fields", () => {
			const input = JSON.stringify({
				entities: [{ name: "Thing" }],
				relations: [],
			});
			const result = parseGraphExtraction(input);
			expect(result.entities[0].content).toBe("Thing"); // defaults to name
			expect(result.entities[0].type).toBe("concept"); // default type
			expect(result.entities[0].tags).toEqual([]);
		});

		it("skips entities without name", () => {
			const input = JSON.stringify({
				entities: [{ content: "No name" }],
				relations: [],
			});
			const result = parseGraphExtraction(input);
			expect(result.entities).toHaveLength(0);
		});

		it("skips relations with missing fields", () => {
			const input = JSON.stringify({
				entities: [],
				relations: [
					{ source: "A", target: "B" }, // missing type
					{ source: "A", type: "uses" }, // missing target
					{ source: "A", target: "B", type: "uses", weight: 0.8 }, // valid
				],
			});
			const result = parseGraphExtraction(input);
			expect(result.relations).toHaveLength(1);
			expect(result.relations[0].type).toBe("uses");
		});

		it("clamps relation weight to 0-1", () => {
			const input = JSON.stringify({
				entities: [],
				relations: [{ source: "A", target: "B", type: "r", weight: 5 }],
			});
			const result = parseGraphExtraction(input);
			expect(result.relations[0].weight).toBe(1);
		});

		it("returns empty for completely unparseable input", () => {
			const result = parseGraphExtraction("not json at all {{{");
			expect(result.entities).toEqual([]);
			expect(result.relations).toEqual([]);
		});
	});

	describe("buildGraphExtractionMessages", () => {
		it("builds system + user messages", () => {
			const messages = [
				{ role: "user", content: "I work on React projects" },
				{ role: "assistant", content: "Nice!" },
			];
			const result = buildGraphExtractionMessages(messages);
			expect(result).toHaveLength(2);
			expect(result[0].role).toBe("system");
			expect(result[1].role).toBe("user");
			expect(result[1].content).toContain("I work on React projects");
		});

		it("uses custom prompt when provided", () => {
			const result = buildGraphExtractionMessages(
				[{ role: "user", content: "test" }],
				"Custom graph prompt",
			);
			expect(result[0].content).toBe("Custom graph prompt");
		});
	});
});
