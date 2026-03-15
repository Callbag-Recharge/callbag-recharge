import { Inspector } from "../inspector";
import { producer } from "../producer";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Emits the latest value from the input source whenever the notifier emits.
 * get() always returns the latest input value (not just the last sampled one).
 * Tier 2 — each emit starts a new DIRTY+value cycle.
 */
export function sample<A>(notifier: Store<unknown>): StoreOperator<A, A> {
	return (input: Store<A>) => {
		let latestInput: A = input.get();

		const store = producer<A>(
			({ emit }) => {
				latestInput = input.get();

				const inputUnsub = subscribe(input, (v) => {
					latestInput = v;
				});

				const notifierUnsub = subscribe(notifier, () => {
					emit(latestInput);
				});

				return () => {
					inputUnsub();
					notifierUnsub();
				};
			},
			{
				initial: latestInput,
				equals: Object.is,
				getter: () => latestInput,
			},
		);
		Inspector.register(store, { kind: "sample" });
		return store;
	};
}
