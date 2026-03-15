import { operator } from "../operator";
import { DATA, END, STATE } from "../protocol";
import type { Store, StoreOperator, StoreOptions } from "../types";

/**
 * Provides a fallback value when the upstream store is undefined.
 * Once upstream emits a non-undefined value, that value is used instead.
 *
 * Stateful: maintains value via operator()'s cache. get() returns the
 * upstream value if non-undefined, otherwise the initial fallback.
 *
 * v3: Tier 1 — uses operator() with single dep. Forwards all type 3
 * STATE signals; on type 1 DATA applies fallback logic and emits.
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
