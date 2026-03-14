import { operator } from "../operator";
import { DATA, DIRTY, END, RESOLVED, STATE } from "../protocol";
import type { Store } from "../types";

/**
 * Merges multiple sources into one. The resulting store's value is the latest
 * emission from whichever source changed most recently.
 *
 * Stateful: maintains last emitted value via operator()'s internal cache.
 * get() returns the most recent value from any source.
 *
 * v3: uses operator() with multi-dep dirty tracking. Forwards DIRTY on first
 * dirty dep; forwards RESOLVED when all pending-dirty deps have resolved.
 * Emits immediately on each type 1 DATA from any source (no waiting).
 *
 * Note: when multiple deps are dirty simultaneously, each dep's DATA triggers
 * a separate emission. The second emission has no preceding DIRTY from merge
 * (only one DIRTY is forwarded per batch). Downstream nodes handle the extra
 * DATA via the "unexpected DATA = immediate trigger" rule (Option 3).
 */
export function merge<T>(...sources: Store<T>[]): Store<T | undefined> {
	return operator<T | undefined>(sources as Store<unknown>[], ({ emit, signal, complete }) => {
		const pendingDirty = new Set<number>();
		let activeCount = sources.length;

		return (dep, type, data) => {
			if (type === STATE) {
				if (data === DIRTY) {
					const wasEmpty = pendingDirty.size === 0;
					pendingDirty.add(dep);
					if (wasEmpty) signal(DIRTY);
				} else if (data === RESOLVED) {
					pendingDirty.delete(dep);
					if (pendingDirty.size === 0) signal(RESOLVED);
				}
			}
			if (type === DATA) {
				pendingDirty.delete(dep);
				emit(data as T);
			}
			if (type === END) {
				pendingDirty.delete(dep);
				activeCount--;
				if (activeCount === 0) complete();
			}
		};
	});
}
