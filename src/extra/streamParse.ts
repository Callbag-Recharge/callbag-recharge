// ---------------------------------------------------------------------------
// streamParse — reactive partial JSON parser for streaming structured output
// ---------------------------------------------------------------------------
// Pipe operator that accumulates string chunks and attempts incremental
// JSON parsing. Emits partial results as they become parseable. Designed
// for streaming structured output from LLMs.
//
// Usage:
//   const parsed = pipe(tokenStream, streamParse({ extract: d => d.answer }));
//   effect([parsed], () => console.log(parsed.get()));
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import type { Store, StoreOperator } from "../core/types";

export interface StreamParseOptions<T> {
	/** Type-safe extractor applied to each successfully parsed value. */
	extract?: (parsed: unknown) => T;
	/**
	 * Parse mode:
	 * - `'partial'` (default): emit on every chunk that produces a new parseable result.
	 * - `'complete'`: only emit when the full JSON is valid (no more chunks expected).
	 */
	mode?: "partial" | "complete";
	/** Debug name for Inspector. */
	name?: string;
}

/** Close unmatched open structures in a string. */
function closeStructures(s: string): string {
	const stack: string[] = [];
	let inStr = false;
	let esc = false;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (esc) {
			esc = false;
			continue;
		}
		if (ch === "\\") {
			esc = true;
			continue;
		}
		if (ch === '"') {
			inStr = !inStr;
			continue;
		}
		if (inStr) continue;
		if (ch === "{") stack.push("}");
		else if (ch === "[") stack.push("]");
		else if (ch === "}" || ch === "]") stack.pop();
	}
	let result = s;
	if (inStr) result += '"';
	for (let i = stack.length - 1; i >= 0; i--) result += stack[i];
	return result;
}

/**
 * Attempts to parse a potentially incomplete JSON string by closing open structures.
 * Returns the parsed value on success, or undefined on failure.
 */
function tryParsePartialJSON(text: string): unknown | undefined {
	// First try the text as-is
	try {
		return JSON.parse(text);
	} catch {
		// Continue to repair attempts
	}

	const trimmed = text.trim();
	if (trimmed.length === 0) return undefined;

	// Track open structure stack for correct closing order
	const stack: string[] = [];
	let inString = false;
	let escaped = false;

	for (let i = 0; i < trimmed.length; i++) {
		const ch = trimmed[i];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (ch === "\\") {
			escaped = true;
			continue;
		}
		if (ch === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;
		if (ch === "{") stack.push("}");
		else if (ch === "[") stack.push("]");
		else if (ch === "}" || ch === "]") stack.pop();
	}

	// If we ended inside a string, close it
	let repaired = trimmed;
	if (inString) {
		repaired += '"';
	}

	// Remove trailing comma (common in streaming objects/arrays)
	repaired = repaired.replace(/,\s*$/, "");

	// Close open structures in reverse order (innermost first)
	for (let i = stack.length - 1; i >= 0; i--) repaired += stack[i];

	try {
		return JSON.parse(repaired);
	} catch {
		// Try progressively stripping trailing partial tokens
		const stripped = repaired.replace(/,\s*"[^"]*"?\s*:?\s*[^,}\]]*$/, "");
		if (stripped !== repaired) {
			try {
				return JSON.parse(closeStructures(stripped));
			} catch {
				return undefined;
			}
		}
		return undefined;
	}
}

/**
 * Reactive partial JSON parser for streaming structured output from LLMs.
 *
 * @param opts - Optional configuration.
 *
 * @returns `StoreOperator<string, T | undefined>` — pipe-compatible. Accumulates string chunks and emits parsed results.
 *
 * @remarks **Partial mode (default):** Attempts to parse after every chunk by closing open structures. Emits whenever a new parseable result is available.
 * @remarks **Complete mode:** Only emits when the accumulated text is valid JSON without repair.
 * @remarks **Graceful fallback:** On parse failure, holds the last successfully parsed value.
 * @remarks **Extractor:** Use `extract` to narrow the parsed type (e.g., `d => d.answer`).
 *
 * @example
 * ```ts
 * import { state, pipe } from 'callbag-recharge';
 * import { streamParse } from 'callbag-recharge/extra/streamParse';
 *
 * const chunks = state('');
 * const parsed = pipe(chunks, streamParse<{ name: string }>());
 *
 * chunks.set('{"name":');
 * parsed.get(); // undefined (not parseable yet)
 * chunks.set('{"name": "Alice"');
 * parsed.get(); // { name: "Alice" } (partial repair closes the brace)
 * chunks.set('{"name": "Alice"}');
 * parsed.get(); // { name: "Alice" } (complete JSON)
 * ```
 *
 * @example With extractor
 * ```ts
 * const parsed = pipe(chunks, streamParse({ extract: (d: any) => d.answer }));
 * chunks.set('{"answer": "42"}');
 * parsed.get(); // "42"
 * ```
 *
 * @seeAlso [scan](/api/scan) — general accumulator, [map](/api/map) — transform values
 *
 * @category extra
 */
export function streamParse<T = unknown>(
	opts?: StreamParseOptions<T>,
): StoreOperator<string, T | undefined> {
	const mode = opts?.mode ?? "partial";
	const extract = opts?.extract;
	const name = opts?.name;

	return (input: Store<string>) => {
		let lastGood: T | undefined;

		return derived(
			[input],
			() => {
				const text = input.get();
				if (!text || text.trim().length === 0) return lastGood;

				let parsed: unknown | undefined;
				if (mode === "complete") {
					try {
						parsed = JSON.parse(text);
					} catch {
						return lastGood;
					}
				} else {
					parsed = tryParsePartialJSON(text);
				}

				if (parsed === undefined) return lastGood;
				if (extract) {
					try {
						lastGood = extract(parsed);
						return lastGood;
					} catch {
						return lastGood;
					}
				}
				lastGood = parsed as T;
				return lastGood;
			},
			{ name: name ?? "streamParse" },
		);
	};
}
