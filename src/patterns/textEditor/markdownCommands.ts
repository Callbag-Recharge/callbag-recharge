/** Character range [start, end) covering full lines that touch selection [a, b]. */
export function affectedLineRange(text: string, a: number, b: number): [number, number] {
	const lo = Math.min(a, b);
	const hi = Math.max(a, b);
	const start = lo <= 0 ? 0 : text.lastIndexOf("\n", lo - 1) + 1;
	const nl = text.indexOf("\n", hi);
	const end = nl === -1 ? text.length : nl;
	return [start, end];
}

const UNORDERED = /^-\s+/;
const ORDERED = /^\d+\.\s+/;

/** Split lines for line-based toggles; a trailing `\n` on the slice becomes a suffix (not an extra empty line). */
function linesFromSegment(segment: string): { lines: string[]; suffixNl: boolean } {
	const suffixNl = segment.endsWith("\n");
	const core = suffixNl ? segment.slice(0, -1) : segment;
	return { lines: core.length === 0 ? [""] : core.split("\n"), suffixNl };
}

function joinWithOptionalSuffix(lines: string[], suffixNl: boolean): string {
	return lines.join("\n") + (suffixNl ? "\n" : "");
}

export interface RangeEdit {
	rangeStart: number;
	rangeEnd: number;
	replacement: string;
	selStart: number;
	selEnd: number;
}

/** Toggle `- ` list markers on touched lines; if all lines already have them, strip. */
export function toggleUnorderedList(text: string, selStart: number, selEnd: number): RangeEdit {
	const [ls, le] = affectedLineRange(text, selStart, selEnd);
	const segment = text.slice(ls, le);
	const { lines, suffixNl } = linesFromSegment(segment);
	const allMarked = lines.length > 0 && lines.every((l) => UNORDERED.test(l));
	const newLines = allMarked
		? lines.map((l) => l.replace(UNORDERED, ""))
		: lines.map((l) => (UNORDERED.test(l) ? l : `- ${l}`));
	const replacement = joinWithOptionalSuffix(newLines, suffixNl);
	const selEndPos = ls + replacement.length;
	return { rangeStart: ls, rangeEnd: le, replacement, selStart: ls, selEnd: selEndPos };
}

/** Toggle `1. ` style list markers; if all lines already match, strip. */
export function toggleOrderedList(text: string, selStart: number, selEnd: number): RangeEdit {
	const [ls, le] = affectedLineRange(text, selStart, selEnd);
	const segment = text.slice(ls, le);
	const { lines, suffixNl } = linesFromSegment(segment);
	const allMarked = lines.length > 0 && lines.every((l) => ORDERED.test(l));
	const newLines = allMarked
		? lines.map((l) => l.replace(ORDERED, ""))
		: lines.map((l, i) => `${i + 1}. ${l.replace(ORDERED, "")}`);
	const replacement = joinWithOptionalSuffix(newLines, suffixNl);
	const selEndPos = ls + replacement.length;
	return { rangeStart: ls, rangeEnd: le, replacement, selStart: ls, selEnd: selEndPos };
}

const HEADING = /^(#{1,3})\s+(.*)$/;

/** Toggle ATX heading: matching level strips; otherwise normalize to `#level `. */
export function toggleHeading(
	text: string,
	selStart: number,
	selEnd: number,
	level: 1 | 2 | 3,
): RangeEdit {
	const [ls, le] = affectedLineRange(text, selStart, selEnd);
	const segment = text.slice(ls, le);
	const { lines, suffixNl } = linesFromSegment(segment);
	const newLines = lines.map((line) => {
		const m = line.match(HEADING);
		if (m && m[1].length === level) return m[2];
		const body = m ? m[2] : line;
		return `${"#".repeat(level)} ${body}`;
	});
	const replacement = joinWithOptionalSuffix(newLines, suffixNl);
	const selEndPos = ls + replacement.length;
	return { rangeStart: ls, rangeEnd: le, replacement, selStart: ls, selEnd: selEndPos };
}

const INLINE_CODE = /^`([^`\n]*)`$/;

/** Toggle single backticks around selection (empty selection inserts a pair and leaves caret inside). */
export function toggleInlineCode(text: string, selStart: number, selEnd: number): RangeEdit {
	const a = Math.min(selStart, selEnd);
	const b = Math.max(selStart, selEnd);
	const raw = text.slice(a, b);
	const m = raw.match(INLINE_CODE);
	if (m) {
		const inner = m[1];
		return {
			rangeStart: a,
			rangeEnd: b,
			replacement: inner,
			selStart: a,
			selEnd: a + inner.length,
		};
	}
	const replacement = `\`${raw}\``;
	const innerStart = a + 1;
	const innerEnd = innerStart + raw.length;
	return {
		rangeStart: a,
		rangeEnd: b,
		replacement,
		selStart: innerStart,
		selEnd: raw.length === 0 ? innerStart : innerEnd,
	};
}

const FENCED_BLOCK = /^```(?:[^\n]*\n)?([\s\S]*?)\n?```$/;

/** Toggle fenced code block around selection. */
export function toggleCodeBlock(text: string, selStart: number, selEnd: number): RangeEdit {
	const a = Math.min(selStart, selEnd);
	const b = Math.max(selStart, selEnd);
	const raw = text.slice(a, b);
	const trimmed = raw.trim();
	const m = trimmed.match(FENCED_BLOCK);
	if (m) {
		const inner = m[1].replace(/^\n+|\n+$/g, "");
		return {
			rangeStart: a,
			rangeEnd: b,
			replacement: inner,
			selStart: a,
			selEnd: a + inner.length,
		};
	}
	const inner = raw.length === 0 ? "\n" : `\n${raw}\n`;
	const replacement = `\`\`\`${inner}\`\`\``;
	const selEndPos = a + replacement.length;
	return {
		rangeStart: a,
		rangeEnd: b,
		replacement,
		selStart: a,
		selEnd: selEndPos,
	};
}
