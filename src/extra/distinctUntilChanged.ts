import { operator } from "../core/operator";
import { DATA, END, RESOLVED, STATE } from "../core/protocol";
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
		return operator<A>(
			[input] as Store<unknown>[],
			({ emit, signal, complete, error }) => {
				let cachedValue: A = input.get();

				return (_dep, type, data) => {
					if (type === STATE) {
						signal(data);
					}
					if (type === DATA) {
						if (!eqFn(cachedValue, data as A)) {
							cachedValue = data as A;
							emit(cachedValue);
						} else {
							signal(RESOLVED);
						}
					}
					if (type === END) {
						if (data !== undefined) {
							error(data);
						} else {
							complete();
						}
					}
				};
			},
			{
				kind: "distinctUntilChanged",
				name: "distinctUntilChanged",
				initial: input.get(),
				getter: () => input.get(),
			},
		);
	};
}
