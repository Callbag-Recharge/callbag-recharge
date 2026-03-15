import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Emits the latest value from the input source whenever the notifier emits.
 *
 * Stateful: maintains latest input value. get() always returns the latest
 * input value (via getter), not just the last sampled emission.
 *
 * v3: Tier 2 — each emit starts a new DIRTY+value cycle (autoDirty: true).
 * No built-in dedup. getter overrides get() to return latest input.
 * Forwards input and notifier completion and errors.
 */
export function sample<A>(notifier: Store<unknown>): StoreOperator<A, A> {
	return (input: Store<A>) => {
		let latestInput: A = input.get();

		const store = producer<A>(
			({ emit, error, complete }) => {
				latestInput = input.get();

				const inputUnsub = subscribe(
					input,
					(v) => {
						latestInput = v;
					},
					{
						onEnd: (err) => {
							if (err !== undefined) {
								error(err);
							} else {
								complete();
							}
						},
					},
				);

				const notifierUnsub = subscribe(
					notifier,
					() => {
						emit(latestInput);
					},
					{
						onEnd: (err) => {
							if (err !== undefined) {
								error(err);
							} else {
								complete();
							}
						},
					},
				);

				return () => {
					inputUnsub();
					notifierUnsub();
				};
			},
			{
				initial: latestInput,
				getter: () => latestInput,
			},
		);
		Inspector.register(store, { kind: "sample" });
		return store;
	};
}
