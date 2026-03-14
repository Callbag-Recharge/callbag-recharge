import { derived } from "../derived";
import { Inspector } from "../inspector";
import type { StoreOperator, StoreOptions } from "../types";

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
