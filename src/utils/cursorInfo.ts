// ---------------------------------------------------------------------------
// cursorInfo — reactive line/column/display from content + cursor position
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import type { Store } from "../core/types";

export interface CursorInfo {
	/** 1-based line number. */
	line: Store<number>;
	/** 1-based column number. */
	column: Store<number>;
	/** Formatted display string, e.g. "Ln 3, Col 12". */
	display: Store<string>;
}

/**
 * Derive cursor line, column, and display string from a text content store
 * and a cursor position (character offset) store.
 *
 * @example
 * ```ts
 * const content = state("hello\nworld");
 * const pos = state(8); // "wo|rld"
 * const cursor = cursorInfo(content, pos);
 * cursor.line.get();    // 2
 * cursor.column.get();  // 3
 * cursor.display.get(); // "Ln 2, Col 3"
 * ```
 */
export function cursorInfo(
	content: Store<string>,
	position: Store<number>,
	opts?: { name?: string },
): CursorInfo {
	const prefix = opts?.name ? `${opts.name}.` : "";

	const line = derived(
		[content, position],
		() => {
			const text = content.get();
			const pos = Math.min(Math.max(0, position.get()), text.length);
			return text.slice(0, pos).split("\n").length;
		},
		{ name: `${prefix}line` },
	);

	const column = derived(
		[content, position],
		() => {
			const text = content.get();
			const pos = Math.min(Math.max(0, position.get()), text.length);
			const before = text.slice(0, pos);
			const lastNewline = before.lastIndexOf("\n");
			return pos - lastNewline;
		},
		{ name: `${prefix}column` },
	);

	const display = derived([line, column], () => `Ln ${line.get()}, Col ${column.get()}`, {
		name: `${prefix}cursorDisplay`,
	});

	return { line, column, display };
}
