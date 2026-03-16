import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Collects all values from a finite source into a single result using a reducer.
 * Emits only once — the final accumulated value — when the source completes.
 *
 * Tier 2: emits the final result as a single DIRTY+value cycle on completion.
 *
 * If the source errors, the error is forwarded and no value is emitted.
 * If the source completes without emitting, the seed is emitted.
 *
 * **Important:** The reducer must not mutate the seed or accumulator. If `seed`
 * is a mutable object (array, object), use immutable operations:
 * ```ts
 * // WRONG: reduce((acc, v) => { acc.push(v); return acc; }, [])
 * // RIGHT: reduce((acc, v) => [...acc, v], [])
 * ```
 * Mutating the seed corrupts it across resubscriptions because `seed` is
 * captured by reference. For array collection, prefer `toArray()`.
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
					unsub();
				};
			},
			{ initial: seed },
		);

		Inspector.register(store, { kind: "reduce" });
		return store;
	};
}
