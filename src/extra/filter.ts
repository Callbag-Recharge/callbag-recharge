import { derived } from "../derived";
import { Inspector } from "../inspector";
import type { StoreOperator, StoreOptions } from "../types";

export function filter<A>(
	predicate: (value: A) => boolean,
	opts?: StoreOptions,
): StoreOperator<A, A | undefined> {
	return (input) => {
		const name = opts?.name ?? `filter(${Inspector.getName(input) ?? "?"})`;
		// Filter holds the last value that passed the predicate.
		// Starts as undefined — nothing has passed yet.
		let lastPassing: A | undefined;
		return derived(
			[input],
			() => {
				const v = input.get();
				if (predicate(v)) lastPassing = v;
				return lastPassing;
			},
			{ name },
		);
	};
}
