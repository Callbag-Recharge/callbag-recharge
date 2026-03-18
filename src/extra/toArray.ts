import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Collects all upstream values into one array, emitted **once** on completion (Tier 2).
 *
 * @returns `StoreOperator<A, A[]>` — empty array if upstream completes without DATA.
 *
 * @seeAlso [reduce](/api/reduce)
 *
 * @category extra
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
