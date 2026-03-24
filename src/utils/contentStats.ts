// ---------------------------------------------------------------------------
// contentStats — reactive word/char/line count from a Store<string>
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { teardown } from "../core/protocol";
import type { Store } from "../core/types";

export interface ContentStats {
	/** Number of whitespace-separated words. Empty string → 0. */
	wordCount: Store<number>;
	/** Total character count. */
	charCount: Store<number>;
	/** Number of lines (split by \n). */
	lineCount: Store<number>;
	/** Tear down all derived stores. */
	dispose(): void;
}

/**
 * Derive word, character, and line counts from a reactive text store.
 *
 * @example
 * ```ts
 * const content = state("hello world");
 * const stats = contentStats(content);
 * stats.wordCount.get(); // 2
 * stats.charCount.get(); // 11
 * stats.lineCount.get(); // 1
 * ```
 */
export function contentStats(content: Store<string>, opts?: { name?: string }): ContentStats {
	const prefix = opts?.name ? `${opts.name}.` : "";

	const wordCount = derived(
		[content],
		() => {
			const text = content.get().trim();
			if (text.length === 0) return 0;
			return text.split(/\s+/).length;
		},
		{ name: `${prefix}wordCount` },
	);

	const charCount = derived([content], () => content.get().length, {
		name: `${prefix}charCount`,
	});

	const lineCount = derived([content], () => content.get().split("\n").length, {
		name: `${prefix}lineCount`,
	});

	function dispose(): void {
		teardown(wordCount);
		teardown(charCount);
		teardown(lineCount);
	}

	return { wordCount, charCount, lineCount, dispose };
}
