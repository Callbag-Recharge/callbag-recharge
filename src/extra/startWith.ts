import { derived } from "../derived";
import { Inspector } from "../inspector";
import type { Store, StoreOperator, StoreOptions } from "../types";

/**
 * Provides a fallback value when the upstream store is undefined.
 * Once upstream emits a non-undefined value, that value is used instead.
 */
export function startWith<A>(initial: A, opts?: StoreOptions): StoreOperator<A | undefined, A> {
	return (input: Store<A | undefined>) => {
		const name = opts?.name ?? `startWith(${Inspector.getName(input) ?? "?"})`;
		const store = derived(
			[input],
			() => {
				const v = input.get();
				return v !== undefined ? v : initial;
			},
			{ name, equals: opts?.equals },
		);
		Inspector.register(store, { kind: "startWith" });
		return store;
	};
}
