// ---------------------------------------------------------------------------
// undoRedo — state wrapper with undo/redo history
// ---------------------------------------------------------------------------
// Wraps a state value with full undo/redo support:
// - Configurable max history depth
// - Reactive canUndo/canRedo/historySize stores
// - clearHistory keeps current value
//
// Built on: state, derived, batch
// ---------------------------------------------------------------------------

import { derived } from "../../core/derived";
import { batch } from "../../core/protocol";
import { state } from "../../core/state";
import type { Store } from "../../core/types";

export interface UndoRedoOptions {
	/** Max history entries (minimum 2). Default: 50 */
	maxHistory?: number;
	/** Equality check — skip duplicate consecutive states. */
	equals?: (a: any, b: any) => boolean;
}

export interface UndoRedoResult<T> {
	/** Current state value (read-only reactive store). */
	current: Store<T>;
	/** Set a new state value (pushes to history). */
	set: (value: T) => void;
	/** Update via function. */
	update: (fn: (current: T) => T) => void;
	/** Undo to previous state. Returns false if nothing to undo. */
	undo: () => boolean;
	/** Redo to next state. Returns false if nothing to redo. */
	redo: () => boolean;
	/** Whether undo is available. */
	canUndo: Store<boolean>;
	/** Whether redo is available. */
	canRedo: Store<boolean>;
	/** Save current value as a checkpoint in history (bypasses equality check). */
	checkpoint: () => void;
	/** Clear all history, keeping current value. */
	clearHistory: () => void;
	/** Number of undo steps available. */
	historySize: Store<number>;
}

/**
 * Creates a state wrapper with undo/redo history.
 *
 * @param initial - The initial state value.
 * @param opts - Optional configuration.
 *
 * @returns `UndoRedoResult<T>` — `current`, `set`, `update`, `undo`, `redo`, `canUndo`, `canRedo`, `checkpoint`, `clearHistory`, `historySize`.
 *
 * @remarks **Max history:** Defaults to 50 entries (minimum 2). Oldest entries are dropped when exceeded.
 * @remarks **Equality check:** If provided, duplicate consecutive values are skipped (except via `checkpoint()`).
 *
 * @category patterns
 */
export function undoRedo<T>(initial: T, opts?: UndoRedoOptions): UndoRedoResult<T> {
	const maxHistory = Math.max(2, opts?.maxHistory ?? 50);
	const equals = opts?.equals;

	// Internal state: history array and pointer index
	const historyStore = state<T[]>([initial], { name: "undoRedo.history" });
	const indexStore = state<number>(0, { name: "undoRedo.index" });

	// Current value derived from history + index
	const current = derived(
		[historyStore, indexStore],
		() => {
			const history = historyStore.get();
			const idx = indexStore.get();
			return history[idx];
		},
		{ name: "undoRedo.current" },
	);

	const canUndo = derived([indexStore], () => indexStore.get() > 0, { name: "undoRedo.canUndo" });

	const canRedo = derived(
		[historyStore, indexStore],
		() => {
			const history = historyStore.get();
			const idx = indexStore.get();
			return idx < history.length - 1;
		},
		{ name: "undoRedo.canRedo" },
	);

	const historySize = derived([indexStore], () => indexStore.get(), {
		name: "undoRedo.historySize",
	});

	function pushValue(value: T, skipEquals = false): void {
		const history = historyStore.get();
		const idx = indexStore.get();
		const currentValue = history[idx];

		// Skip if equals and values are the same (unless skipEquals for checkpoint)
		if (!skipEquals && equals?.(currentValue, value)) return;

		// Truncate any redo states
		const newHistory = history.slice(0, idx + 1);
		newHistory.push(value);

		// Cap at maxHistory (keep the most recent entries)
		if (newHistory.length > maxHistory) {
			newHistory.splice(0, newHistory.length - maxHistory);
		}

		// Atomic update — prevents intermediate derived emissions with stale index
		batch(() => {
			historyStore.set(newHistory);
			indexStore.set(newHistory.length - 1);
		});
	}

	function setValue(value: T): void {
		pushValue(value);
	}

	function updateValue(fn: (current: T) => T): void {
		const history = historyStore.get();
		const idx = indexStore.get();
		pushValue(fn(history[idx]));
	}

	function undo(): boolean {
		const idx = indexStore.get();
		if (idx <= 0) return false;
		indexStore.set(idx - 1);
		return true;
	}

	function redo(): boolean {
		const history = historyStore.get();
		const idx = indexStore.get();
		if (idx >= history.length - 1) return false;
		indexStore.set(idx + 1);
		return true;
	}

	function checkpoint(): void {
		const history = historyStore.get();
		const idx = indexStore.get();
		// Force push current value, bypassing equality check
		pushValue(history[idx], true);
	}

	function clearHistory(): void {
		const history = historyStore.get();
		const idx = indexStore.get();
		const currentValue = history[idx];
		batch(() => {
			historyStore.set([currentValue]);
			indexStore.set(0);
		});
	}

	return {
		current,
		set: setValue,
		update: updateValue,
		undo,
		redo,
		canUndo,
		canRedo,
		checkpoint,
		clearHistory,
		historySize,
	};
}
