import { derived } from "../derived";
import { Inspector } from "../inspector";
import type { StoreOperator, StoreOptions } from "../types";

/**
 * Conditionally forwards upstream values. When the predicate returns false,
 * holds the last passing value.
 *
 * Stateful: maintains last passing value via derived()'s internal cache.
 * get() returns the last value that passed the predicate, or undefined.
 *
 * v3: uses derived() with equals:Object.is — when predicate is false and
 * lastPassing is unchanged, derived sends RESOLVED (subtree skipping) instead
 * of re-emitting. Predicate-true emissions with a new value always propagate.
 */
export function filter<A>(
	predicate: (value: A) => boolean,
	opts?: StoreOptions,
): StoreOperator<A, A | undefined> {
	return (input) => {
		const name = opts?.name ?? `filter(${Inspector.getName(input) ?? "?"})`;
		let lastPassing: A | undefined;
		return derived(
			[input],
			() => {
				const v = input.get();
				if (predicate(v)) lastPassing = v;
				return lastPassing;
			},
			{ name, equals: opts?.equals ?? Object.is },
		);
	};
}
