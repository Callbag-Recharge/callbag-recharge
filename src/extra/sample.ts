import { Inspector } from "../inspector";
import { producer } from "../producer";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Emits the latest value from the input source whenever the notifier emits.
 *
 * Stateful: maintains latest input value. get() always returns the latest
 * input value (via getter), not just the last sampled emission.
 *
 * v3: Tier 2 — each emit starts a new DIRTY+value cycle (autoDirty: true).
 * equals: Object.is dedup. getter overrides get() to return latest input.
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
