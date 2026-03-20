// ---------------------------------------------------------------------------
// selection — generic reactive selection model
// ---------------------------------------------------------------------------
// Works for text cursors, list item selection, table ranges, tree nodes.
// Supports single position (cursor), range, and multi-select modes.
//
// Built on: state, derived, batch
// ---------------------------------------------------------------------------

import { derived } from "../../core/derived";
import { batch } from "../../core/protocol";
import { state } from "../../core/state";
import type { Store } from "../../core/types";

export interface SelectionOptions {
	/** Selection mode. Default: 'range' */
	mode?: "single" | "range" | "multi";
	/** Total selectable length (for clamp). Can be reactive. */
	length?: number | Store<number>;
	/** Debug name prefix. */
	name?: string;
}

export interface SelectionResult {
	/** Start position (inclusive). */
	start: Store<number>;
	/** End position (inclusive). In 'single' mode, always equals start. */
	end: Store<number>;
	/** Whether the selection is collapsed (start === end). */
	collapsed: Store<boolean>;
	/** Length of the selection (|end - start|). */
	size: Store<number>;
	/** Direction of the selection. */
	direction: Store<"forward" | "backward" | "none">;

	/** Set a selection range. In 'single' mode, only start is used. */
	select(start: number, end: number): void;
	/** Collapse selection to a single position. */
	collapse(position: number): void;
	/** Collapse to the start of the current selection. */
	collapseToStart(): void;
	/** Collapse to the end of the current selection. */
	collapseToEnd(): void;
	/** Extend the selection by a delta. */
	extend(by: number): void;
	/** Select all (0 to length). */
	selectAll(): void;
	/** Move cursor by a delta (collapses selection). */
	moveCursor(by: number): void;
	/** Dispose — no-op after first call. */
	dispose(): void;
}

/**
 * Creates a generic reactive selection model.
 *
 * @param opts - Optional configuration.
 *
 * @returns `SelectionResult` — reactive start/end/collapsed/size/direction stores + control methods.
 *
 * @remarks **Batch atomicity:** `select()` updates start+end atomically via `batch()`.
 * @remarks **Boundary clamping:** Positions are clamped to [0, length] when a length is provided.
 * @remarks **Modes:** 'single' collapses end to start; 'range' allows arbitrary ranges; 'multi' is reserved for future use.
 *
 * @example
 * ```ts
 * import { selection } from 'callbag-recharge/patterns/selection';
 *
 * const sel = selection({ length: 100 });
 * sel.select(10, 20);
 * sel.start.get(); // 10
 * sel.end.get();   // 20
 * sel.size.get();  // 10
 * sel.collapsed.get(); // false
 *
 * sel.collapse(15);
 * sel.collapsed.get(); // true
 * ```
 *
 * @category patterns
 */
export function selection(opts?: SelectionOptions): SelectionResult {
	const mode = opts?.mode ?? "range";
	const prefix = opts?.name ?? "selection";
	const lengthOpt = opts?.length;

	const startStore = state<number>(0, { name: `${prefix}.start` });
	const endStore = state<number>(0, { name: `${prefix}.end` });

	// Resolve length — may be reactive or static
	function getLength(): number {
		if (lengthOpt == null) return Number.MAX_SAFE_INTEGER;
		if (typeof lengthOpt === "number") return lengthOpt;
		return lengthOpt.get();
	}

	function clamp(value: number): number {
		const len = getLength();
		if (value < 0) return 0;
		if (value > len) return len;
		return value;
	}

	const collapsed = derived([startStore, endStore], () => startStore.get() === endStore.get(), {
		name: `${prefix}.collapsed`,
	});

	const size = derived([startStore, endStore], () => Math.abs(endStore.get() - startStore.get()), {
		name: `${prefix}.size`,
	});

	const direction = derived(
		[startStore, endStore],
		(): "forward" | "backward" | "none" => {
			const s = startStore.get();
			const e = endStore.get();
			if (s === e) return "none";
			return e > s ? "forward" : "backward";
		},
		{ name: `${prefix}.direction` },
	);

	let disposed = false;

	function select(s: number, e: number): void {
		if (disposed) return;
		const cs = clamp(s);
		const ce = mode === "single" ? cs : clamp(e);
		batch(() => {
			startStore.set(cs);
			endStore.set(ce);
		});
	}

	function collapse(position: number): void {
		if (disposed) return;
		const p = clamp(position);
		batch(() => {
			startStore.set(p);
			endStore.set(p);
		});
	}

	function collapseToStart(): void {
		if (disposed) return;
		const s = clamp(Math.min(startStore.get(), endStore.get()));
		batch(() => {
			startStore.set(s);
			endStore.set(s);
		});
	}

	function collapseToEnd(): void {
		if (disposed) return;
		const e = clamp(Math.max(startStore.get(), endStore.get()));
		batch(() => {
			startStore.set(e);
			endStore.set(e);
		});
	}

	function extend(by: number): void {
		if (disposed) return;
		if (mode === "single") return;
		endStore.set(clamp(endStore.get() + by));
	}

	function selectAll(): void {
		if (disposed) return;
		if (mode === "single") {
			collapse(0);
			return;
		}
		const len = getLength();
		batch(() => {
			startStore.set(0);
			endStore.set(len === Number.MAX_SAFE_INTEGER ? 0 : len);
		});
	}

	function moveCursor(by: number): void {
		if (disposed) return;
		const current = endStore.get();
		const next = clamp(current + by);
		batch(() => {
			startStore.set(next);
			endStore.set(next);
		});
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
	}

	return {
		start: startStore,
		end: endStore,
		collapsed,
		size,
		direction,
		select,
		collapse,
		collapseToStart,
		collapseToEnd,
		extend,
		selectAll,
		moveCursor,
		dispose,
	};
}
