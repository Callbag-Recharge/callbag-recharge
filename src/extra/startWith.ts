import { derived } from "../core/derived";
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
		return derived<A>(
			[input as Store<unknown>],
			() => {
				const v = input.get();
				return v !== undefined ? v : initial;
			},
			{
				kind: "startWith",
				name: opts?.name ?? "startWith",
				equals: opts?.equals,
			},
		);
	};
}
