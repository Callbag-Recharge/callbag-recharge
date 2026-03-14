import { Inspector } from "../inspector";
import { derived } from "../derived";
import type { Store, StoreOperator } from "../types";

/**
 * Provides a fallback value when the upstream store is undefined.
 * Once upstream emits a non-undefined value, that value is used instead.
 */
export function startWith<A>(initial: A): StoreOperator<A | undefined, A> {
	return (input: Store<A | undefined>) => {
		const store = derived([input], () => {
			const v = input.get();
			return v !== undefined ? v : initial;
		});
		Inspector.register(store, { kind: "startWith" });
		return store;
	};
}
