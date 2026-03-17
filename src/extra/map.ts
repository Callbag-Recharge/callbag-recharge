import { operator } from "../core/operator";
import { DATA, END, RESOLVED, STATE } from "../core/protocol";
import type { Store, StoreOperator, StoreOptions } from "../core/types";

/**
 * Transforms each upstream value through `fn`.
 *
 * Stateful: maintains transformed value via operator()'s cache. get()
 * returns fn(input.get()).
 *
 * v3: Tier 1 — uses operator() with single dep. Forwards type 3
 * STATE signals; on type 1 DATA applies fn and emits. Optional equals
 * enables push-phase memoization via RESOLVED.
 */
export function map<A, B>(fn: (value: A) => B, opts?: StoreOptions): StoreOperator<A, B> {
	return (input) => {
		const eqFn = opts?.equals;
		const initialValue = fn(input.get());
		return operator<B>(
			[input] as Store<unknown>[],
			({ emit, signal, complete, error }) => {
				let prev: B = initialValue;

				return (_dep, type, data) => {
					if (type === STATE) {
						signal(data);
					}
					if (type === DATA) {
						const mapped = fn(data as A);
						if (eqFn?.(prev, mapped)) {
							signal(RESOLVED);
							return;
						}
						prev = mapped;
						emit(mapped);
					}
					if (type === END) {
						if (data !== undefined) error(data);
						else complete();
					}
				};
			},
			{
				kind: "map",
				name: opts?.name ?? "map",
				initial: initialValue,
				getter: () => fn(input.get()),
			},
		);
	};
}
