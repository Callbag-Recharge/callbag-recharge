// ---------------------------------------------------------------------------
// autoSave — debounce + checkpoint + status in one utility
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { effect } from "../core/effect";
import { pipe } from "../core/pipe";
import { teardown } from "../core/protocol";
import type { Store } from "../core/types";
import { debounce } from "../extra/debounce";
import type { CheckpointAdapter, CheckpointedStore } from "./checkpoint";
import { checkpoint } from "./checkpoint";

export interface AutoSaveResult<T> {
	/** Debounced content — fires after quiet period. */
	debouncedContent: Store<T | undefined>;
	/** Checkpointed store — latest persisted value. */
	checkpointed: CheckpointedStore<T>;
	/** Auto-save status: "saved" when checkpoint matches, "saving" when debounced, "unsaved" when dirty. */
	status: Store<"saved" | "saving" | "unsaved">;
	/** Tear down debounce + checkpoint + status effect. */
	dispose(): void;
}

export interface AutoSaveOptions {
	/** Debounce interval in ms (default: 1000). */
	debounceMs?: number;
	/** Checkpoint persistence ID. */
	checkpointId?: string;
	/** Store name prefix. */
	name?: string;
	/** Callback to mark upstream clean after successful save. */
	markClean?: () => void;
}

/**
 * Wire up auto-save for any content store: debounce → checkpoint → status.
 *
 * Requires a `dirty` store to track whether the buffer has unsaved changes.
 * After each successful checkpoint persist, optionally calls `markClean()`.
 *
 * @example
 * ```ts
 * const editor = textEditor({ initial: "" });
 * const save = autoSave(editor.buffer.content, editor.buffer.dirty, memoryAdapter(), {
 *   debounceMs: 1000,
 *   checkpointId: "my-editor",
 *   markClean: () => editor.buffer.markClean(),
 * });
 * save.status.get(); // "saved" | "saving" | "unsaved"
 * save.dispose();
 * ```
 */
export function autoSave<T>(
	content: Store<T>,
	dirty: Store<boolean>,
	adapter: CheckpointAdapter,
	opts?: AutoSaveOptions,
): AutoSaveResult<T> {
	const debounceMs = opts?.debounceMs ?? 1000;
	const checkpointId = opts?.checkpointId ?? "autosave";
	const prefix = opts?.name ?? "";

	const debouncedContent = pipe(content, debounce(debounceMs));

	const save = checkpoint<T>(checkpointId, adapter, {
		name: prefix ? `${prefix}.checkpoint` : undefined,
	});
	const checkpointed = save(debouncedContent as Store<T>);

	// Track whether debounce has flushed: true when content !== last debounced value
	const debouncePending = derived(
		[content, debouncedContent],
		() => {
			const dc = debouncedContent.get();
			// undefined = never flushed yet → debounce IS pending
			return dc === undefined ? true : content.get() !== dc;
		},
		{ name: prefix ? `${prefix}.debouncePending` : undefined },
	);

	// Status: "saved" (clean), "saving" (debounce flushed, checkpoint pending), "unsaved" (editing)
	const status = derived(
		[dirty, debouncePending],
		(): "saved" | "saving" | "unsaved" => {
			if (!dirty.get()) return "saved";
			if (!debouncePending.get()) return "saving";
			return "unsaved";
		},
		{ name: prefix ? `${prefix}.autoSaveStatus` : undefined },
	);

	// Only markClean when checkpoint matches current content
	const disposeClean = effect([checkpointed], () => {
		const cp = checkpointed.get();
		if (cp !== undefined && opts?.markClean && cp === content.get()) {
			opts.markClean();
		}
		return undefined;
	});

	function dispose(): void {
		disposeClean();
		teardown(debouncedContent);
		teardown(debouncePending);
		teardown(status);
		teardown(checkpointed);
		checkpointed.clear();
	}

	return { debouncedContent, checkpointed, status, dispose };
}
