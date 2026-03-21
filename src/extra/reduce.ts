import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Folds a finite stream into one value, emitting **once** on upstream completion (Tier 2).
 *
 * @param reducer - Pure fold; must not mutate `acc` if `seed` is mutable (use immutable updates).
 * @param seed - Initial accumulator; also emitted if upstream completes without DATA.
 *
 * @returns `StoreOperator<A, B>` — errors propagate without emission.
 *
 * @remarks **Immutability:** Mutating `seed` breaks resubscribe semantics; prefer `[...acc, v]` or `toArray()`.
 *
 * @seeAlso [toArray](/api/toArray), [scan](/api/scan)
 *
 * @category extra
 */
export function reduce<A, B>(reducer: (acc: B, value: A) => B, seed: B): StoreOperator<A, B> {
	return (input: Store<A>) => {
		const store = producer<B>(
			({ emit, error, complete }) => {
				let acc = seed;

				const unsub = subscribe(
					input,
					(v) => {
						acc = reducer(acc, v);
					},
					{
						onEnd: (err) => {
							if (err !== undefined) {
								error(err);
							} else {
								emit(acc);
								complete();
							}
						},
					},
				);

				return () => {
					unsub.unsubscribe();
				};
			},
			{ initial: seed },
		);

		Inspector.register(store, { kind: "reduce" });
		return store;
	};
}
