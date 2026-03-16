import { operator } from "../core/operator";
import { DATA, DIRTY, END, RESOLVED, STATE } from "../core/protocol";
import type { Store } from "../core/types";

/**
 * Merges multiple sources into one. The resulting store's value is the latest
 * emission from whichever source changed most recently.
 *
 * Stateful: maintains last emitted value via operator()'s internal cache.
 * get() returns the most recent value from any source.
 *
 * v3: uses operator() with multi-dep dirty tracking via bitmask. Forwards
 * DIRTY on first dirty dep; forwards RESOLVED when all pending-dirty deps
 * have resolved. Emits immediately on each type 1 DATA from any source.
 *
 * Note: when multiple deps are dirty simultaneously, each dep's DATA triggers
 * a separate emission. The second emission has no preceding DIRTY from merge
 * (only one DIRTY is forwarded per batch). Downstream nodes handle the extra
 * DATA via the "unexpected DATA = immediate trigger" rule (Option 3).
 */
export function merge<T>(...sources: Store<T>[]): Store<T | undefined> {
	return operator<T | undefined>(
		sources as Store<unknown>[],
		({ emit, signal, complete, error }) => {
			let dirtyDeps = 0;
			let activeCount = sources.length;

			return (dep, type, data) => {
				const depBit = 1 << dep;

				if (type === STATE) {
					if (data === DIRTY) {
						const wasClean = dirtyDeps === 0;
						dirtyDeps |= depBit;
						if (wasClean) signal(DIRTY);
					} else if (data === RESOLVED) {
						if (dirtyDeps & depBit) {
							dirtyDeps &= ~depBit;
							if (dirtyDeps === 0) signal(RESOLVED);
						}
					} else {
						signal(data); // Forward unknown STATE signals (v4 forward-compat)
					}
				}
				if (type === DATA) {
					dirtyDeps &= ~depBit;
					emit(data as T);
				}
				if (type === END) {
					dirtyDeps &= ~depBit;
					if (data !== undefined) {
						error(data);
					} else {
						activeCount--;
						if (activeCount === 0) complete();
					}
				}
			};
		},
		{ kind: "merge", name: "merge" },
	);
}
