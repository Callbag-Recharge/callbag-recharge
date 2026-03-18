import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { state } from "../core/state";
import type { Store, StoreOperator, WritableStore } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Fixed-size counting windows: each inner store receives up to `count` values (Tier 2).
 *
 * @param count - Values per window before rotating.
 *
 * @returns `StoreOperator<A, Store<A> | undefined>`
 *
 * @category extra
 */
export function windowCount<A>(count: number): StoreOperator<A, Store<A> | undefined> {
	return (input: Store<A>) => {
		const store = producer<Store<A>>(({ emit, error, complete }) => {
			let currentWindow: WritableStore<A> | null = state(input.get());
			let windowSize = 0;

			// Emit the initial window
			emit(currentWindow as Store<A>);

			const unsub = subscribe(
				input,
				(v) => {
					if (!currentWindow) return;
					currentWindow.set(v);
					windowSize++;

					if (windowSize >= count) {
						windowSize = 0;
						currentWindow = state<A | undefined>(undefined) as WritableStore<A>;
						emit(currentWindow as Store<A>);
					}
				},
				{
					onEnd: (err) => {
						currentWindow = null;
						if (err !== undefined) {
							error(err);
						} else {
							complete();
						}
					},
				},
			);

			return () => {
				currentWindow = null;
				windowSize = 0;
				unsub();
			};
		});

		Inspector.register(store, { kind: "windowCount" });
		return store;
	};
}
