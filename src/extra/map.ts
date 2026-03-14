import { derived } from "../derived";
import { Inspector } from "../inspector";
import type { StoreOperator, StoreOptions } from "../types";

export function map<A, B>(fn: (value: A) => B, opts?: StoreOptions): StoreOperator<A, B> {
	return (input) => {
		const name = opts?.name ?? `map(${Inspector.getName(input) ?? "?"})`;
		return derived([input], () => fn(input.get()), { name, equals: opts?.equals });
	};
}
