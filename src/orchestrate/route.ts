// ---------------------------------------------------------------------------
// route — dynamic conditional routing
// ---------------------------------------------------------------------------
// Splits a source into two output stores based on a predicate. Both outputs
// participate in diamond resolution (Tier 1). When the predicate doesn't match,
// the output sends RESOLVED to avoid blocking downstream.
//
// Usage:
//   const [evens, odds] = route(numbers, n => n % 2 === 0);
// ---------------------------------------------------------------------------

import { operator } from "../core/operator";
import { DATA, END, RESOLVED, STATE } from "../core/protocol";
import type { Store } from "../core/types";

/**
 * Splits a source into `[matching, notMatching]` stores based on a predicate.
 * Both outputs are Tier 1 stores that participate in diamond resolution.
 *
 * @param source - The upstream store to route.
 * @param pred - Predicate function. `true` → first output, `false` → second output.
 * @param opts - Optional configuration.
 *
 * @returns `[Store<T | undefined>, Store<T | undefined>]` — `[matching, notMatching]` stores. Each returns `undefined` from `get()` when the predicate doesn't match.
 *
 * @remarks **Tier 1:** Both outputs forward type 3 STATE signals and send RESOLVED when suppressing a value.
 * @remarks **Diamond-safe:** When used in a diamond topology, downstream nodes compute exactly once per upstream change.
 * @remarks **Predicate errors:** If the predicate throws, the error is forwarded downstream via the callbag END protocol.
 *
 * @example
 * ```ts
 * import { state } from 'callbag-recharge';
 * import { route } from 'callbag-recharge/orchestrate';
 * import { subscribe } from 'callbag-recharge';
 *
 * const n = state(0);
 * const [evens, odds] = route(n, v => v % 2 === 0);
 * subscribe(evens, v => console.log("even:", v));
 * subscribe(odds, v => console.log("odd:", v));
 * n.set(2); // logs "even: 2"
 * n.set(3); // logs "odd: 3"
 * ```
 *
 * @seeAlso [filter](/api/filter) — single-output filtering, [partition](/api/partition) — similar but as pipe operator
 *
 * @category orchestrate
 */
export function route<T>(
	source: Store<T>,
	pred: (value: T) => boolean,
	opts?: { name?: string },
): [Store<T | undefined>, Store<T | undefined>] {
	const baseName = opts?.name ?? "route";

	const matching = operator<T | undefined>(
		[source],
		({ emit, signal, complete, error }) => {
			return (_depIndex, type, data) => {
				if (type === STATE) signal(data);
				else if (type === DATA) {
					try {
						if (pred(data as T)) emit(data as T);
						else signal(RESOLVED); // suppress without blocking downstream
					} catch (e) {
						error(e);
					}
				} else if (type === END) {
					if (data !== undefined) error(data);
					else complete();
				}
			};
		},
		{
			name: `${baseName}:match`,
			kind: "route",
			getter: () => {
				try {
					const v = source.get();
					return pred(v) ? v : undefined;
				} catch {
					return undefined;
				}
			},
		},
	);

	const notMatching = operator<T | undefined>(
		[source],
		({ emit, signal, complete, error }) => {
			return (_depIndex, type, data) => {
				if (type === STATE) signal(data);
				else if (type === DATA) {
					try {
						if (!pred(data as T)) emit(data as T);
						else signal(RESOLVED); // suppress without blocking downstream
					} catch (e) {
						error(e);
					}
				} else if (type === END) {
					if (data !== undefined) error(data);
					else complete();
				}
			};
		},
		{
			name: `${baseName}:miss`,
			kind: "route",
			getter: () => {
				try {
					const v = source.get();
					return !pred(v) ? v : undefined;
				} catch {
					return undefined;
				}
			},
		},
	);

	return [matching, notMatching];
}
