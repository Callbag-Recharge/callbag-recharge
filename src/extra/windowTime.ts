import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { RESET } from "../core/protocol";
import { state } from "../core/state";
import type { Store, StoreOperator, WritableStore } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Time-based windows: new inner store every `ms` (Tier 2).
 *
 * @param ms - Window duration in milliseconds.
 *
 * @returns `StoreOperator<A, Store<A> | undefined>`
 *
 * @category extra
 */
export function windowTime<A>(ms: number): StoreOperator<A, Store<A> | undefined> {
	return (input: Store<A>) => {
		const store = producer<Store<A>>(({ emit, error, complete, onSignal }) => {
			let currentWindow: WritableStore<A> | null = state(input.get());

			// Emit the initial window
			emit(currentWindow as Store<A>);

			const timer = setInterval(() => {
				currentWindow = state<A | undefined>(undefined) as WritableStore<A>;
				emit(currentWindow as Store<A>);
			}, ms);

			const unsub = subscribe(
				input,
				(v) => {
					if (currentWindow) {
						currentWindow.set(v);
					}
				},
				{
					onEnd: (err) => {
						clearInterval(timer);
						currentWindow = null;
						if (err !== undefined) {
							error(err);
						} else {
							complete();
						}
					},
				},
			);

			onSignal((s) => {
				unsub.signal(s);
				if (s === RESET) {
					currentWindow = null;
					clearInterval(timer);
				}
			});

			return () => {
				clearInterval(timer);
				currentWindow = null;
				unsub.unsubscribe();
			};
		});

		Inspector.register(store, { kind: "windowTime" });
		return store;
	};
}
