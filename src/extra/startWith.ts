import { operator } from "../core/operator";
import { DATA, END, STATE } from "../core/protocol";
import type { Store, StoreOperator, StoreOptions } from "../core/types";

/**
 * Uses `initial` whenever upstream is `undefined`; once upstream is defined, passes it through (Tier 1).
 *
 * @param initial - Fallback value for `undefined` upstream.
 * @param opts - Optional `StoreOptions`.
 *
 * @returns `StoreOperator<A | undefined, A>`
 *
 * @category extra
 */
export function startWith<A>(initial: A, opts?: StoreOptions): StoreOperator<A | undefined, A> {
	return (input: Store<A | undefined>) => {
		return operator<A>(
			[input] as Store<unknown>[],
			({ emit, signal, complete, error }) => {
				return (_dep, type, data) => {
					if (type === STATE) {
						signal(data);
					}
					if (type === DATA) {
						const v = data as A | undefined;
						emit(v !== undefined ? v : initial);
					}
					if (type === END) {
						if (data !== undefined) error(data);
						else complete();
					}
				};
			},
			{
				kind: "startWith",
				name: opts?.name ?? "startWith",
				initial: (() => {
					const v = input.get();
					return v !== undefined ? v : initial;
				})(),
				getter: () => {
					const v = input.get();
					return v !== undefined ? v : initial;
				},
			},
		);
	};
}
