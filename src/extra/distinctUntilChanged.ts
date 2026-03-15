import { operator } from "../operator";
import { DATA, END, RESOLVED, STATE } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Filters out consecutive duplicate values. When upstream emits a value equal
 * to the cached one, sends RESOLVED downstream (enabling subtree skipping)
 * instead of re-emitting the unchanged value.
 *
 * Stateful: maintains cached value via operator()'s internal cache.
 * get() returns the last distinct value.
 *
 * v3: Tier 1 — uses operator() with single dep. Forwards DIRTY on type 3
 * STATE; on type 1 DATA checks equality and emits or sends RESOLVED.
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
