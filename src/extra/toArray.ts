import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Collects all values from a finite source into an array.
 * Emits once — the collected array — when the source completes.
 *
 * Tier 2: emits the final array as a single DIRTY+value cycle on completion.
 *
 * If the source errors, the error is forwarded and no value is emitted.
 * If the source completes without emitting, an empty array is emitted.
 */
export function toArray<A>(): StoreOperator<A, A[]> {
	return (input: Store<A>) => {
		const store = producer<A[]>(
			({ emit, error, complete }) => {
				let items: A[] = [];

				const unsub = subscribe(
					input,
					(v) => {
						items.push(v);
					},
					{
						onEnd: (err) => {
							if (err !== undefined) {
								items = [];
								error(err);
							} else {
								const result = items;
								Object.freeze(result);
								items = [];
								emit(result);
								complete();
							}
						},
					},
				);

				return () => {
					items = [];
					unsub();
				};
			},
			{ initial: [] as A[] },
		);

		Inspector.register(store, { kind: "toArray" });
		return store;
	};
}
