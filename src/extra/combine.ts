import { derived } from "../derived";
import type { Store } from "../types";

/**
 * Combines multiple sources into a single store whose value is a tuple
 * of all source values. Recomputes whenever any source changes.
 *
 * Stateful: maintains tuple value via derived()'s cache. get() returns
 * the current tuple of all source values.
 *
 * v3: Tier 1 — inherits derived()'s diamond resolution. Always produces
 * a new array reference, so Object.is equality never matches. For custom
 * equality, pipe through distinctUntilChanged(shallowEq).
 */
export function combine<Sources extends Store<unknown>[]>(
	...sources: Sources
): Store<{ [K in keyof Sources]: Sources[K] extends Store<infer T> ? T : never }> {
	type Result = {
		[K in keyof Sources]: Sources[K] extends Store<infer T> ? T : never;
	};
	return derived(sources, () => sources.map((s) => s.get()) as unknown as Result);
}
