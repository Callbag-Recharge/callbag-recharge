import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { RESET } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * On each notifier emission, emits the **latest** value from the primary input (Tier 2).
 *
 * @param notifier - Sampling clock store.
 *
 * @returns `StoreOperator<A, A>` — `get()` reflects latest input, not only last sample.
 *
 * @category extra
 */
export function sample<A>(notifier: Store<unknown>): StoreOperator<A, A> {
	return (input: Store<A>) => {
		let latestInput: A = input.get();

		const store = producer<A>(
			({ emit, error, complete, onSignal }) => {
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

				onSignal((s) => {
					inputUnsub.signal(s);
					notifierUnsub.signal(s);
					if (s === RESET) {
						latestInput = undefined as A;
					}
				});

				return () => {
					inputUnsub.unsubscribe();
					notifierUnsub.unsubscribe();
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
