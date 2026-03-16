import { operator } from "../core/operator";
import { DATA, DIRTY, END, RESOLVED, STATE } from "../core/protocol";
import type { Store } from "../core/types";

/**
 * Combines multiple sources into a single store whose value is a tuple
 * of all source values. Recomputes whenever any source changes.
 *
 * Stateful: maintains tuple value via operator()'s cache. get() returns
 * the current tuple of all source values.
 *
 * v3: Tier 1 — uses operator() with multi-dep dirty tracking via bitmask.
 * Forwards DIRTY on first dirty dep; recomputes and emits when all dirty
 * deps have resolved via DATA. If all dirty deps RESOLVED without DATA,
 * forwards RESOLVED (subtree skipping). Always produces a new array ref.
 */
export function combine<Sources extends Store<unknown>[]>(
	...sources: Sources
): Store<{ [K in keyof Sources]: Sources[K] extends Store<infer T> ? T : never }> {
	type Result = {
		[K in keyof Sources]: Sources[K] extends Store<infer T> ? T : never;
	};
	const values = sources.map((s) => s.get());

	return operator<Result>(
		sources as Store<unknown>[],
		({ emit, signal, complete, error }) => {
			let dirtyDeps = 0;
			let anyDataReceived = false;
			let activeCount = sources.length;

			return (dep, type, data) => {
				const depBit = 1 << dep;

				if (type === STATE) {
					if (data === DIRTY) {
						const wasClean = dirtyDeps === 0;
						dirtyDeps |= depBit;
						if (wasClean) {
							anyDataReceived = false;
							signal(DIRTY);
						}
					} else if (data === RESOLVED) {
						if (dirtyDeps & depBit) {
							dirtyDeps &= ~depBit;
							if (dirtyDeps === 0) {
								if (anyDataReceived) {
									emit([...values] as unknown as Result);
								} else {
									signal(RESOLVED);
								}
							}
						}
					} else {
						signal(data); // Forward unknown STATE signals (v4 forward-compat)
					}
				}
				if (type === DATA) {
					values[dep] = data;
					if (dirtyDeps & depBit) {
						dirtyDeps &= ~depBit;
						anyDataReceived = true;
						if (dirtyDeps === 0) {
							emit([...values] as unknown as Result);
						}
					} else {
						// DATA without prior DIRTY (raw callbag source)
						if (dirtyDeps === 0) {
							signal(DIRTY);
							emit([...values] as unknown as Result);
						} else {
							anyDataReceived = true;
						}
					}
				}
				if (type === END) {
					if (data !== undefined) {
						error(data);
					} else {
						activeCount--;
						if (activeCount === 0) complete();
					}
				}
			};
		},
		{
			kind: "combine",
			name: "combine",
			initial: [...values] as unknown as Result,
			getter: () => sources.map((s) => s.get()) as unknown as Result,
		},
	);
}
