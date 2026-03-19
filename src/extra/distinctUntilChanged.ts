import { derived } from "../core/derived";
import type { Store, StoreOperator } from "../core/types";

/**
 * Drops consecutive duplicates; optional `eq` replaces default `Object.is` (Tier 1).
 *
 * @param eq - Equality for consecutive pair comparison.
 *
 * @returns `StoreOperator<A, A>`
 *
 * @seeAlso [filter](/api/filter)
 *
 * @category extra
 */
export function distinctUntilChanged<A>(eq?: (a: A, b: A) => boolean): StoreOperator<A, A> {
	const eqFn = eq ?? Object.is;
	return (input: Store<A>) => {
		return derived.from(input, {
			kind: "distinctUntilChanged",
			name: "distinctUntilChanged",
			equals: eqFn,
		});
	};
}
