import { derived } from "../../core/derived";
import { batch } from "../../core/protocol";
import type { Store } from "../../core/types";
import { dirtyTracker } from "../../utils/dirtyTracker";
import { type SelectionResult, selection } from "../selection";
import { type UndoRedoResult, undoRedo } from "../undoRedo";

/** Document + selection snapshot for undo/redo (caret is collapsed when start === end). */
export interface TextBufferSnapshot {
	text: string;
	start: number;
	end: number;
}

export interface TextBufferOptions {
	maxHistory?: number;
	equals?: (a: string, b: string) => boolean;
	name?: string;
}

export interface TextBufferResult {
	content: Store<string>;
	lineCount: Store<number>;
	charCount: Store<number>;
	cursor: SelectionResult;
	history: UndoRedoResult<TextBufferSnapshot>;
	dirty: Store<boolean>;
	markClean(): void;
	insert(text: string): void;
	delete(direction?: "forward" | "backward"): void;
	replace(text: string): void;
	replaceAll(text: string): void;
	/** Replace [rangeStart, rangeEnd) with `replacement` in one undo step; selection becomes [caretStart, caretEnd] (defaults to collapsed after replacement). */
	replaceRange(
		rangeStart: number,
		rangeEnd: number,
		replacement: string,
		caretStart?: number,
		caretEnd?: number,
	): void;
	getRange(start: number, end: number): string;
	selectedText: Store<string>;
	getLine(n: number): string;
	insertLine(n: number, text: string): void;
	dispose(): void;
}

function snapshotEquals(
	a: TextBufferSnapshot,
	b: TextBufferSnapshot,
	strEq?: (x: string, y: string) => boolean,
): boolean {
	const sameText = strEq ? strEq(a.text, b.text) : a.text === b.text;
	return sameText && a.start === b.start && a.end === b.end;
}

function clampSel(s: TextBufferSnapshot): { start: number; end: number } {
	const len = s.text.length;
	const st = Math.max(0, Math.min(s.start, len));
	const en = Math.max(0, Math.min(s.end, len));
	return { start: st, end: en };
}

/**
 * Headless reactive text document: content, cursor, dirty tracking, and undo history.
 *
 * @param initial - Initial document text.
 * @param opts - Optional `maxHistory`, per-field `equals` for text deduping, and `name`.
 *
 * @returns `TextBufferResult` — `content` is derived from the undo stack; `history` stores
 * `TextBufferSnapshot` values (`text` + selection). Use `history.undo` / `redo` (not raw index
 * hacks) so the caret stays in sync. `replaceRange` applies a slice edit and caret in one step.
 *
 * @remarks **Undo snapshots:** Each edit pushes `{ text, start, end }`. Moving the caret alone
 * does not push history — only `insert`, `delete`, `replace`, `replaceAll`, and `replaceRange` do.
 * @remarks **Undo/redo:** `history.undo` and `redo` run in a `batch` so `content` and cursor updates
 * commit together for subscribers.
 *
 * @optionsType TextBufferOptions
 * @option maxHistory | number | 100 | Max undo steps (minimum 2 internally).
 * @option equals | (a: string, b: string) => boolean | — | Optional; when set, compares `text` fields of snapshots. Indices must still match for equality skip.
 * @option name | string | `"textBuffer"` | Debug name prefix for child stores.
 *
 * @category patterns
 */
export function textBuffer(initial = "", opts?: TextBufferOptions): TextBufferResult {
	const prefix = opts?.name ?? "textBuffer";
	const snap0: TextBufferSnapshot = {
		text: initial,
		start: initial.length,
		end: initial.length,
	};
	const base = undoRedo<TextBufferSnapshot>(snap0, {
		maxHistory: opts?.maxHistory ?? 100,
		equals: (a, b) => snapshotEquals(a, b, opts?.equals),
	});

	const content = derived([base.current], () => base.current.get().text, {
		name: `${prefix}.content`,
	});
	const charCount = derived([content], () => content.get().length, { name: `${prefix}.charCount` });
	const lineCount = derived([content], () => Math.max(1, content.get().split("\n").length), {
		name: `${prefix}.lineCount`,
	});
	const cursor = selection({ mode: "range", length: charCount, name: `${prefix}.cursor` });
	cursor.collapse(initial.length);

	const tracker = dirtyTracker(content, initial, { equals: opts?.equals, name: `${prefix}.dirty` });

	const selectedText = derived([content, cursor.start, cursor.end], () => {
		const value = content.get();
		const s = cursor.start.get();
		const e = cursor.end.get();
		const start = Math.min(s, e);
		const end = Math.max(s, e);
		return value.slice(start, end);
	});

	function syncCursorFromSnapshot(): void {
		const { start: st, end: en } = clampSel(base.current.get());
		cursor.select(st, en);
	}

	const history: UndoRedoResult<TextBufferSnapshot> = {
		...base,
		undo: () => {
			let ok = false;
			batch(() => {
				ok = base.undo();
				if (ok) syncCursorFromSnapshot();
			});
			return ok;
		},
		redo: () => {
			let ok = false;
			batch(() => {
				ok = base.redo();
				if (ok) syncCursorFromSnapshot();
			});
			return ok;
		},
	};

	function getSel(): { start: number; end: number } {
		const s = cursor.start.get();
		const e = cursor.end.get();
		return { start: Math.min(s, e), end: Math.max(s, e) };
	}

	function applyReplace(start: number, end: number, text: string): void {
		const value = content.get();
		const next = value.slice(0, start) + text + value.slice(end);
		const nextPos = start + text.length;
		batch(() => {
			base.set({ text: next, start: nextPos, end: nextPos });
			cursor.collapse(nextPos);
		});
	}

	function insert(text: string): void {
		const { start, end } = getSel();
		applyReplace(start, end, text);
	}

	function deleteText(direction: "forward" | "backward" = "backward"): void {
		const value = content.get();
		const { start, end } = getSel();
		if (start !== end) {
			applyReplace(start, end, "");
			return;
		}
		if (direction === "forward") {
			if (end >= value.length) return;
			applyReplace(end, end + 1, "");
			return;
		}
		if (start <= 0) return;
		applyReplace(start - 1, start, "");
	}

	function replace(text: string): void {
		insert(text);
	}

	function replaceAll(text: string): void {
		const len = text.length;
		batch(() => {
			base.set({ text, start: len, end: len });
			cursor.collapse(len);
		});
	}

	function replaceRange(
		rangeStart: number,
		rangeEnd: number,
		replacement: string,
		caretStart?: number,
		caretEnd?: number,
	): void {
		const value = content.get();
		const rs = Math.max(0, Math.min(rangeStart, value.length));
		const re = Math.max(rs, Math.min(rangeEnd, value.length));
		const next = value.slice(0, rs) + replacement + value.slice(re);
		const c0 = caretStart ?? rs + replacement.length;
		const c1 = caretEnd ?? c0;
		const { start: st, end: en } = clampSel({ text: next, start: c0, end: c1 });
		batch(() => {
			base.set({ text: next, start: st, end: en });
			cursor.select(st, en);
		});
	}

	function getRange(start: number, end: number): string {
		const value = content.get();
		const s = Math.max(0, Math.min(start, value.length));
		const e = Math.max(0, Math.min(end, value.length));
		return value.slice(Math.min(s, e), Math.max(s, e));
	}

	function getLine(n: number): string {
		const lines = content.get().split("\n");
		if (n < 0 || n >= lines.length) return "";
		return lines[n];
	}

	function insertLine(n: number, text: string): void {
		const lines = content.get().split("\n");
		const idx = Math.max(0, Math.min(n, lines.length));
		lines.splice(idx, 0, text);
		replaceAll(lines.join("\n"));
	}

	function markClean(): void {
		tracker.resetBaseline();
	}

	function dispose(): void {
		cursor.dispose();
		tracker.dispose();
	}

	return {
		content,
		lineCount,
		charCount,
		cursor,
		history,
		dirty: tracker.dirty,
		markClean,
		insert,
		delete: deleteText,
		replace,
		replaceAll,
		replaceRange,
		getRange,
		selectedText,
		getLine,
		insertLine,
		dispose,
	};
}
