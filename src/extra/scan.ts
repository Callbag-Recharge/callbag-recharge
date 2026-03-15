import { derived } from "../derived";
import { Inspector } from "../inspector";
import type { StoreOperator, StoreOptions } from "../types";

/**
 * Accumulates upstream values through `reducer`, starting from `seed`.
 *
 * Stateful: maintains accumulated value via derived()'s cache. get()
 * returns the current accumulator.
 *
 * v3: Tier 1 — inherits derived()'s diamond resolution. Type 3 DIRTY/RESOLVED
 * propagated automatically; type 1 DATA carries accumulated values.
 */
export function scan<A, B>(
	reducer: (acc: B, value: A) => B,
	seed: B,
	opts?: StoreOptions,
): StoreOperator<A, B> {
	return (input) => {
		const name = opts?.name ?? `scan(${Inspector.getName(input) ?? "?"})`;
		let acc = seed;
		return derived(
			[input],
			() => {
				acc = reducer(acc, input.get());
				return acc;
			},
			{ name, equals: opts?.equals },
		);
	};
}
