// ---------------------------------------------------------------------------
// agentMemory extraction — LLM fact extraction from conversation messages
// ---------------------------------------------------------------------------

import type { LLMMessage } from "../fromLLM";
import type { ExtractedFact } from "./types";

export const DEFAULT_EXTRACTION_PROMPT = `You are a memory extraction system. Given a conversation, extract discrete factual statements worth remembering for future conversations.

Output ONLY a JSON array. Each element has:
- "content": concise factual statement (1-2 sentences)
- "importance": float 0-1 (1.0 = critical fact/preference, 0.5 = useful context, 0.1 = minor detail)
- "tags": string array of categories from: ["preference", "fact", "skill", "opinion", "context", "personal", "technical", "project"]

Rules:
- Extract ONLY genuine facts, preferences, and lasting context
- Skip greetings, filler, questions, and transient conversation mechanics
- Deduplicate: if the same fact appears multiple times, extract it once
- Be concise: each content should be a single clear statement
- If there is nothing worth remembering, return an empty array []

Example output:
[
  {"content": "User prefers TypeScript over JavaScript", "importance": 0.8, "tags": ["preference", "technical"]},
  {"content": "User is building a state management library", "importance": 0.9, "tags": ["project", "technical"]}
]`;

/**
 * Build the LLM messages for fact extraction.
 */
export function buildExtractionMessages(
	messages: Array<{ role: string; content: string }>,
	customPrompt?: string,
): LLMMessage[] {
	const systemPrompt = customPrompt ?? DEFAULT_EXTRACTION_PROMPT;

	// Serialize conversation messages into the user prompt
	const conversation = messages.map((m) => `${m.role}: ${m.content}`).join("\n");

	return [
		{ role: "system", content: systemPrompt },
		{ role: "user", content: conversation },
	];
}

/**
 * Parse LLM output into structured facts.
 * Handles valid JSON arrays and degrades gracefully for malformed output.
 */
export function parseFacts(llmOutput: string): ExtractedFact[] {
	const trimmed = llmOutput.trim();
	if (!trimmed) return [];

	// Try JSON array parse first
	try {
		// Direct parse — handles clean JSON output
		const direct = JSON.parse(trimmed);
		if (Array.isArray(direct)) {
			return direct.map(normalizeFact).filter((f): f is ExtractedFact => f !== null);
		}
	} catch {
		// May be wrapped in markdown or have surrounding text
	}

	// Extract outermost JSON array (may be wrapped in markdown code block or prose)
	try {
		const start = trimmed.indexOf("[");
		const end = trimmed.lastIndexOf("]");
		if (start !== -1 && end > start) {
			const parsed = JSON.parse(trimmed.slice(start, end + 1));
			if (Array.isArray(parsed)) {
				return parsed.map(normalizeFact).filter((f): f is ExtractedFact => f !== null);
			}
		}
	} catch {
		// Fall through to line-by-line parsing
	}

	// Fallback: try parsing each line as JSON
	const lines = trimmed.split("\n").filter((l) => l.trim());
	const facts: ExtractedFact[] = [];
	for (const line of lines) {
		try {
			const parsed = JSON.parse(line.trim().replace(/^[-*]\s*/, ""));
			const fact = normalizeFact(parsed);
			if (fact) facts.push(fact);
		} catch {
			// Skip unparseable lines
		}
	}

	return facts;
}

function normalizeFact(raw: unknown): ExtractedFact | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;

	const content = typeof obj.content === "string" ? obj.content.trim() : "";
	if (!content) return null;

	const importance =
		typeof obj.importance === "number" ? Math.max(0, Math.min(1, obj.importance)) : 0.5;

	const tags = Array.isArray(obj.tags)
		? obj.tags.filter((t): t is string => typeof t === "string")
		: [];

	return { content, importance, tags };
}
