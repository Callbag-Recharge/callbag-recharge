// ---------------------------------------------------------------------------
// dirtyTracker — reactive dirty tracking against a baseline value
// ---------------------------------------------------------------------------
// Tracks whether a source store has diverged from a baseline value.
// Extracted as a generic utility from formField's baked-in dirty logic.
//
// Use cases: editors, forms, settings panels, config diff, "unsaved changes"
//
// Built on: state (baseline), derived (dirty comparison)
// ---------------------------------------------------------------------------

import { derived } from "../core/derived";
import { state } from "../core/state";
import type { Store } from "../core/types";

export interface DirtyTrackerOptions<T> {
	/** Custom equality function. Default: Object.is */
	equals?: (a: T, b: T) => boolean;
	/** Debug name. */
	name?: string;
}

export interface DirtyTrackerResult<T> {
	/** Whether the source has diverged from the baseline. */
	dirty: Store<boolean>;
	/** The current baseline value (reactive). */
	baseline: Store<T>;
	/** Update the baseline (e.g., after save). If no value given, uses current source value. */
	resetBaseline(value?: T): void;
	/** Dispose — disconnects the derived store. */
	dispose(): void;
}

/**
 * Creates a reactive dirty tracker that compares a source store against a baseline.
 *
 * @param source - The store to track.
 * @param initial - The initial baseline value.
 * @param opts - Optional configuration.
 *
 * @returns `DirtyTrackerResult<T>` — `dirty`, `baseline`, `resetBaseline`, `dispose`.
 *
 * @example
 * ```ts
 * import { state } from 'callbag-recharge';
 * import { dirtyTracker } from 'callbag-recharge/utils';
 *
 * const content = state('hello');
 * const tracker = dirtyTracker(content, 'hello');
 *
 * tracker.dirty.get(); // false
 * content.set('hello world');
 * tracker.dirty.get(); // true
 *
 * tracker.resetBaseline(); // baseline = 'hello world'
 * tracker.dirty.get(); // false
 * ```
 *
 * @category utils
 */
export function dirtyTracker<T>(
	source: Store<T>,
	initial: T,
	opts?: DirtyTrackerOptions<T>,
): DirtyTrackerResult<T> {
	const eq = opts?.equals ?? Object.is;
	const name = opts?.name ?? "dirtyTracker";

	const baselineStore = state<T>(initial, { name: `${name}.baseline` });

	const dirty = derived([source, baselineStore], () => !eq(source.get(), baselineStore.get()), {
		name: `${name}.dirty`,
	});

	let disposed = false;

	function resetBaseline(...args: [T?]): void {
		if (disposed) return;
		baselineStore.set(args.length > 0 ? (args[0] as T) : source.get());
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
	}

	return { dirty, baseline: baselineStore, resetBaseline, dispose };
}
