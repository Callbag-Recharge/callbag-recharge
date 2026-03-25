// ---------------------------------------------------------------------------
// systemPromptBuilder — reactive system prompt assembly with token budgets
// ---------------------------------------------------------------------------
// Assembles a final system prompt from multiple reactive sections, each backed
// by a Store<string>. Manages token budget allocation: sections with maxTokens
// are truncated to fit; total budget ensures the prompt stays within limits.
//
// Built on: derived (multi-dep reactive composition)
// ---------------------------------------------------------------------------

import { derived } from "../../core/derived";
import { teardown } from "../../core/protocol";
import type { Store } from "../../core/types";

/** Rough token estimate: ~1.3 tokens per whitespace-delimited word. */
function estimateTokens(text: string): number {
	const words = text.split(/\s+/).filter(Boolean).length;
	return Math.ceil(words * 1.3);
}

/** Truncate text to fit within a token budget, cutting at word boundaries. */
function truncateToTokens(text: string, maxTokens: number): string {
	const words = text.split(/\s+/).filter(Boolean);
	let tokens = 0;
	for (let i = 0; i < words.length; i++) {
		tokens += 1.3;
		if (tokens > maxTokens) {
			return words.slice(0, i).join(" ");
		}
	}
	return text;
}

export interface PromptSection {
	/** Section label used as a header in the assembled prompt. */
	name: string;
	/** Reactive store providing section content. Empty string = section omitted. */
	content: Store<string>;
	/** Optional per-section token limit. Content exceeding this is truncated. */
	maxTokens?: number;
}

export interface SystemPromptBuilderOptions {
	/** Ordered list of prompt sections. Sections are assembled in array order. */
	sections: PromptSection[];
	/** Overall token budget for the assembled prompt. Sections are trimmed back-to-front to fit. */
	maxTotalTokens?: number;
	/** Debug name for the derived store. */
	name?: string;
}

export interface SystemPromptBuilderStore extends Store<string> {
	/** Tear down the derived store. Does not destroy the section content stores. */
	destroy(): void;
}

/**
 * Assembles a system prompt from multiple reactive sections with token budgets.
 *
 * @param opts - Sections, total token budget, and optional debug name.
 *
 * @returns `SystemPromptBuilderStore` — `Store<string>` with the assembled prompt, plus `destroy()`.
 *
 * @remarks **Section format:** Each section with non-empty content is rendered as
 *   `## <name>\n<content>`, separated by double newlines.
 * @remarks **Per-section budgets:** If a section has `maxTokens`, its content is truncated
 *   at word boundaries to fit.
 * @remarks **Total budget:** If `maxTotalTokens` is set, sections are trimmed back-to-front
 *   (last section first) until the total fits. This prioritizes earlier sections.
 *
 * @example
 * ```ts
 * import { state } from 'callbag-recharge';
 * import { systemPromptBuilder } from 'callbag-recharge/ai';
 *
 * const rules = state('You are a helpful assistant.');
 * const docs = state('## API Reference\nget() returns the current value.');
 * const memory = state('User prefers concise answers.');
 *
 * const prompt = systemPromptBuilder({
 *   sections: [
 *     { name: 'Rules', content: rules },
 *     { name: 'Documentation', content: docs, maxTokens: 500 },
 *     { name: 'User Memory', content: memory, maxTokens: 200 },
 *   ],
 *   maxTotalTokens: 1000,
 * });
 *
 * prompt.get(); // "## Rules\nYou are a helpful assistant.\n\n## Documentation\n..."
 * ```
 *
 * @category ai
 */
export function systemPromptBuilder(opts: SystemPromptBuilderOptions): SystemPromptBuilderStore {
	const deps = opts.sections.map((s) => s.content);
	const name = opts.name ?? "systemPromptBuilder";

	const promptStore = derived(
		deps,
		() => {
			// Phase 1: collect non-empty sections, apply per-section limits
			const assembled: Array<{ name: string; text: string }> = [];
			for (const section of opts.sections) {
				let text = section.content.get();
				if (!text) continue;
				if (section.maxTokens !== undefined) {
					text = truncateToTokens(text, section.maxTokens);
				}
				if (!text) continue;
				assembled.push({ name: section.name, text });
			}

			// Phase 2: enforce total token budget (trim back-to-front)
			if (opts.maxTotalTokens !== undefined) {
				let totalTokens = 0;
				for (const s of assembled) {
					// Include header overhead: "## <name>\n" ≈ a few tokens
					totalTokens += estimateTokens(`## ${s.name}\n${s.text}`);
				}
				// Trim from the back to stay within budget
				for (let i = assembled.length - 1; i >= 0 && totalTokens > opts.maxTotalTokens; i--) {
					const current = estimateTokens(`## ${assembled[i].name}\n${assembled[i].text}`);
					const overshoot = totalTokens - opts.maxTotalTokens;
					if (overshoot >= current) {
						// Remove entire section
						totalTokens -= current;
						assembled.splice(i, 1);
					} else {
						// Truncate this section to fit
						const headerTokens = estimateTokens(`## ${assembled[i].name}\n`);
						const allowedContentTokens = Math.max(0, current - overshoot - headerTokens);
						assembled[i].text = truncateToTokens(assembled[i].text, allowedContentTokens);
						if (!assembled[i].text) {
							totalTokens -= current;
							assembled.splice(i, 1);
						} else {
							totalTokens = opts.maxTotalTokens; // close enough after truncation
						}
					}
				}
			}

			// Phase 3: render
			return assembled.map((s) => `## ${s.name}\n${s.text}`).join("\n\n");
		},
		{ name },
	);

	function destroy(): void {
		teardown(promptStore);
	}

	// Return the real store with destroy attached, preserving store identity (P5)
	return Object.assign(promptStore, { destroy }) as SystemPromptBuilderStore;
}
