import { derived } from "../../core/derived";
import { state } from "../../core/state";
import type { Store } from "../../core/types";
import {
	type AsyncValidator,
	type SyncValidator,
	validationPipeline,
} from "../../utils/validationPipeline";
import { type CommandBusResult, type CommandDef, commandBus } from "../commandBus";
import { type FocusManagerResult, focusManager } from "../focusManager";
import { type TextBufferResult, textBuffer } from "../textBuffer";
import {
	toggleCodeBlock,
	toggleHeading,
	toggleInlineCode,
	toggleOrderedList,
	toggleUnorderedList,
} from "./markdownCommands";

export interface TextEditorOptions {
	initial?: string;
	placeholder?: string;
	maxLength?: number;
	validators?: SyncValidator<string>[];
	asyncValidators?: AsyncValidator<string>[];
	markdown?: boolean | ((content: string) => string);
	onSubmit?: (content: string) => void | Promise<void>;
	onCancel?: () => void;
	name?: string;
}

export interface EditorCommands extends Record<string, CommandDef<any, any>> {
	bold: CommandDef<void, void>;
	italic: CommandDef<void, void>;
	heading: CommandDef<{ level: 1 | 2 | 3 }, void>;
	link: CommandDef<{ url: string; text?: string }, void>;
	list: CommandDef<{ ordered: boolean }, void>;
	code: CommandDef<{ block: boolean }, void>;
	undo: CommandDef<void, void>;
	redo: CommandDef<void, void>;
}

export interface TextEditorResult {
	buffer: TextBufferResult;
	commands: CommandBusResult<EditorCommands>;
	focus: FocusManagerResult;
	error: Store<string>;
	valid: Store<boolean>;
	preview: Store<string>;
	submit(): Promise<void>;
	cancel(): void;
	canSubmit: Store<boolean>;
	submitting: Store<boolean>;
	dispose(): void;
}

export function textEditor(opts?: TextEditorOptions): TextEditorResult {
	const prefix = opts?.name ?? "textEditor";
	const buffer = textBuffer(opts?.initial ?? "", { name: `${prefix}.buffer` });
	const submitting = state(false, { name: `${prefix}.submitting` });
	const focus = focusManager(["editor", "toolbar"], { name: `${prefix}.focus` });

	const validators: SyncValidator<string>[] = [];
	if (opts?.maxLength !== undefined) {
		validators.push((value) =>
			value.length > opts.maxLength! ? `Maximum length is ${opts.maxLength}` : true,
		);
	}
	if (opts?.validators) validators.push(...opts.validators);

	const validation = validationPipeline(buffer.content, {
		sync: validators,
		async: opts?.asyncValidators,
		name: `${prefix}.validation`,
	});

	function wrap(token: string): void {
		const sel = buffer.selectedText.get();
		if (sel.length > 0) {
			buffer.replace(`${token}${sel}${token}`);
			return;
		}
		buffer.insert(`${token}${token}`);
		buffer.cursor.moveCursor(-token.length);
	}

	function applyMarkdownEdit(
		fn: (
			text: string,
			start: number,
			end: number,
		) => {
			rangeStart: number;
			rangeEnd: number;
			replacement: string;
			selStart: number;
			selEnd: number;
		},
	): void {
		const value = buffer.content.get();
		const start = buffer.cursor.start.get();
		const end = buffer.cursor.end.get();
		const edit = fn(value, start, end);
		buffer.replaceRange(
			edit.rangeStart,
			edit.rangeEnd,
			edit.replacement,
			edit.selStart,
			edit.selEnd,
		);
	}

	const commands = commandBus<EditorCommands>(
		{
			bold: { execute: () => wrap("**") },
			italic: { execute: () => wrap("*") },
			heading: {
				execute: ({ level }) => applyMarkdownEdit((text, s, e) => toggleHeading(text, s, e, level)),
			},
			link: {
				execute: ({ url, text }) => {
					const selected = buffer.selectedText.get();
					const label = text ?? (selected.length > 0 ? selected : url);
					buffer.replace(`[${label}](${url})`);
				},
			},
			list: {
				execute: ({ ordered }) =>
					applyMarkdownEdit((text, s, e) =>
						ordered ? toggleOrderedList(text, s, e) : toggleUnorderedList(text, s, e),
					),
			},
			code: {
				execute: ({ block }) =>
					applyMarkdownEdit((text, s, e) =>
						block ? toggleCodeBlock(text, s, e) : toggleInlineCode(text, s, e),
					),
			},
			undo: {
				execute: () => {
					buffer.history.undo();
				},
			},
			redo: {
				execute: () => {
					buffer.history.redo();
				},
			},
		},
		{ name: `${prefix}.commands` },
	);

	const preview = derived([buffer.content], () => {
		const value = buffer.content.get();
		if (opts?.markdown === true) return value;
		if (typeof opts?.markdown === "function") return opts.markdown(value);
		return value;
	});

	const canSubmit = derived([buffer.content, validation.valid, submitting], () => {
		const nonEmpty = buffer.content.get().trim().length > 0;
		return nonEmpty && validation.valid.get() && !submitting.get();
	});

	async function submit(): Promise<void> {
		if (!canSubmit.get()) return;
		submitting.set(true);
		try {
			await opts?.onSubmit?.(buffer.content.get());
			buffer.markClean();
		} finally {
			submitting.set(false);
		}
	}

	function cancel(): void {
		opts?.onCancel?.();
	}

	function dispose(): void {
		commands.dispose();
		focus.dispose();
		validation.dispose();
		buffer.dispose();
	}

	return {
		buffer,
		commands,
		focus,
		error: validation.error,
		valid: validation.valid,
		preview,
		submit,
		cancel,
		canSubmit,
		submitting,
		dispose,
	};
}
