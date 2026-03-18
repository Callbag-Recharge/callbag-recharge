import { operator } from "../core/operator";
import { DATA, END, STATE } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";

/**
 * Runs `fn` for each value then re-emits it unchanged (Tier 1).
 *
 * @param fn - Observer side effect.
 *
 * @returns `StoreOperator<A, A>`
 *
 * @category extra
 */
export function tap<A>(fn: (value: A) => void): StoreOperator<A, A> {
	return (input: Store<A>) => {
		return operator<A>(
			[input] as Store<unknown>[],
			({ emit, signal, complete, error }) => {
				return (_dep, type, data) => {
					if (type === STATE) {
						signal(data);
					}
					if (type === DATA) {
						fn(data as A);
						emit(data as A);
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
			{ kind: "tap", name: "tap", initial: input.get(), getter: () => input.get() },
		);
	};
}
