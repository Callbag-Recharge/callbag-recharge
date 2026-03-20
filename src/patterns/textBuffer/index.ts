import { derived } from "../../core/derived";
import { batch } from "../../core/protocol";
import type { Store } from "../../core/types";
import { dirtyTracker } from "../../utils/dirtyTracker";
import { type SelectionResult, selection } from "../selection";
import { type UndoRedoResult, undoRedo } from "../undoRedo";

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
	history: UndoRedoResult<string>;
	dirty: Store<boolean>;
	markClean(): void;
	insert(text: string): void;
	delete(direction?: "forward" | "backward"): void;
	replace(text: string): void;
	replaceAll(text: string): void;
	getRange(start: number, end: number): string;
	selectedText: Store<string>;
	getLine(n: number): string;
	insertLine(n: number, text: string): void;
	dispose(): void;
}

export function textBuffer(initial = "", opts?: TextBufferOptions): TextBufferResult {
	const prefix = opts?.name ?? "textBuffer";
	const history = undoRedo<string>(initial, {
		maxHistory: opts?.maxHistory ?? 100,
		equals: opts?.equals,
	});
	const content = history.current;
	const charCount = derived([content], () => content.get().length, { name: `${prefix}.charCount` });
	const lineCount = derived([content], () => Math.max(1, content.get().split("\n").length), {
		name: `${prefix}.lineCount`,
	});
	const cursor = selection({ mode: "range", length: charCount, name: `${prefix}.cursor` });
	// Text buffers are usually initialized with the cursor at the end.
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
			history.set(next);
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
		batch(() => {
			history.set(text);
			cursor.collapse(text.length);
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
		getRange,
		selectedText,
		getLine,
		insertLine,
		dispose,
	};
}
