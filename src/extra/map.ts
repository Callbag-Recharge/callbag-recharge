import { derived } from "../derived";
import { Inspector } from "../inspector";
import type { StoreOperator, StoreOptions } from "../types";

/**
 * Transforms each upstream value through `fn`.
 *
 * Stateful: maintains transformed value via derived()'s cache. get()
 * returns fn(input.get()).
 *
 * v3: Tier 1 — inherits derived()'s diamond resolution. Type 3 DIRTY/RESOLVED
 * propagated automatically; type 1 DATA carries transformed values.
 */
export function map<A, B>(fn: (value: A) => B, opts?: StoreOptions): StoreOperator<A, B> {
	return (input) => {
		const name = opts?.name ?? `map(${Inspector.getName(input) ?? "?"})`;
		return derived([input], () => fn(input.get()), { name, equals: opts?.equals });
	};
}
