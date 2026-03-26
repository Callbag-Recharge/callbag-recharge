// ---------------------------------------------------------------------------
// agentMemory graph extraction — LLM entity/relation extraction (SA-4d)
// ---------------------------------------------------------------------------

import type { LLMMessage } from "../fromLLM";
import type { ExtractedEntity, ExtractedRelation, GraphExtractionResult } from "./types";

export const DEFAULT_GRAPH_EXTRACTION_PROMPT = `You are an entity/relation extraction system. Given a conversation, extract entities (people, concepts, projects, technologies) and their relationships.

Output ONLY a JSON object with two arrays:
- "entities": each has "name" (identifier), "content" (description), "type" (person/concept/project/technology/organization), "tags" (string array)
- "relations": each has "source" (entity name), "target" (entity name), "type" (verb: uses/depends_on/created_by/works_on/knows/part_of), "weight" (float 0-1)

Rules:
- Extract real entities and relationships, not conversation mechanics
- Entity names should be stable identifiers (use canonical forms)
- Relations are directed: source → target
- If nothing meaningful, return {"entities": [], "relations": []}

Example:
{"entities": [{"name": "Alice", "content": "Software engineer working on state management", "type": "person", "tags": ["user"]}, {"name": "TypeScript", "content": "Programming language", "type": "technology", "tags": ["language"]}], "relations": [{"source": "Alice", "target": "TypeScript", "type": "uses", "weight": 0.9}]}`;

/**
 * Build LLM messages for graph extraction (SA-4d).
 */
export function buildGraphExtractionMessages(
	messages: Array<{ role: string; content: string }>,
	customPrompt?: string,
): LLMMessage[] {
	const systemPrompt = customPrompt ?? DEFAULT_GRAPH_EXTRACTION_PROMPT;
	const conversation = messages.map((m) => `${m.role}: ${m.content}`).join("\n");

	return [
		{ role: "system", content: systemPrompt },
		{ role: "user", content: conversation },
	];
}

/**
 * Parse LLM output into entities and relations.
 */
export function parseGraphExtraction(llmOutput: string): GraphExtractionResult {
	const trimmed = llmOutput.trim();
	if (!trimmed) return { entities: [], relations: [] };

	let parsed: unknown;

	// Try direct parse
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		// Try extracting JSON from markdown/prose
		try {
			const start = trimmed.indexOf("{");
			const end = trimmed.lastIndexOf("}");
			if (start !== -1 && end > start) {
				parsed = JSON.parse(trimmed.slice(start, end + 1));
			}
		} catch {
			return { entities: [], relations: [] };
		}
	}

	if (!parsed || typeof parsed !== "object") return { entities: [], relations: [] };

	const obj = parsed as Record<string, unknown>;
	const entities = Array.isArray(obj.entities)
		? obj.entities.map(normalizeEntity).filter((e): e is ExtractedEntity => e !== null)
		: [];
	const relations = Array.isArray(obj.relations)
		? obj.relations.map(normalizeRelation).filter((r): r is ExtractedRelation => r !== null)
		: [];

	return { entities, relations };
}

function normalizeEntity(raw: unknown): ExtractedEntity | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;

	const name = typeof obj.name === "string" ? obj.name.trim() : "";
	if (!name) return null;

	const content = typeof obj.content === "string" ? obj.content.trim() : name;
	const type = typeof obj.type === "string" ? obj.type.trim() : "concept";
	const tags = Array.isArray(obj.tags)
		? obj.tags.filter((t): t is string => typeof t === "string")
		: [];

	return { name, content, type, tags };
}

function normalizeRelation(raw: unknown): ExtractedRelation | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;

	const source = typeof obj.source === "string" ? obj.source.trim() : "";
	const target = typeof obj.target === "string" ? obj.target.trim() : "";
	const type = typeof obj.type === "string" ? obj.type.trim() : "";
	if (!source || !target || !type) return null;

	const weight = typeof obj.weight === "number" ? Math.max(0, Math.min(1, obj.weight)) : 1;

	return { source, target, type, weight };
}
