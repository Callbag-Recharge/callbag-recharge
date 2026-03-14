import { derived } from "../derived";
import type { Store } from "../types";

/**
 * Combines multiple sources into a single store whose value is a tuple
 * of all source values. Recomputes whenever any source changes.
 *
 * Note: combine always produces a new array reference, so Object.is equality
 * never matches. For custom equality (e.g. shallow array comparison), pipe
 * through distinctUntilChanged(shallowEq) or wrap in derived() with equals.
 * The variadic rest-args API does not support an opts parameter.
 */
export function combine<Sources extends Store<unknown>[]>(
	...sources: Sources
): Store<{ [K in keyof Sources]: Sources[K] extends Store<infer T> ? T : never }> {
	type Result = {
		[K in keyof Sources]: Sources[K] extends Store<infer T> ? T : never;
	};
	return derived(sources, () => sources.map((s) => s.get()) as unknown as Result);
}
