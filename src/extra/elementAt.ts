import { operator } from "../core/operator";
import { DATA, END, STATE } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";

/**
 * Emits the value at zero-based emission index `index`, then completes.
 *
 * @param index - Which DATA emission to capture (0 = first).
 *
 * @returns `StoreOperator<A, A | undefined>` — Tier 1.
 *
 * @category extra
 */
export function elementAt<A>(index: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		return operator<A | undefined>(
			[input] as Store<unknown>[],
			({ emit, signal, complete, error, disconnect }) => {
				let count = 0;
				let done = false;

				return (_dep, type, data) => {
					if (type === STATE) {
						if (!done) signal(data);
					}
					if (type === DATA) {
						if (!done) {
							if (count === index) {
								done = true;
								emit(data as A);
								disconnect();
								complete();
							}
							count++;
						}
					}
					if (type === END) {
						if (!done) {
							done = true;
							if (data !== undefined) {
								error(data);
							} else {
								complete();
							}
						}
					}
				};
			},
		);
	};
}
