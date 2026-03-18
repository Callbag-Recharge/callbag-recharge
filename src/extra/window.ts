import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { END, START } from "../core/protocol";
import { state } from "../core/state";
import type { Store, StoreOperator, WritableStore } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Multiplexes upstream into per-window writable stores; notifier edges close/open windows (Tier 2).
 *
 * @param notifier - Emissions delimit windows.
 *
 * @returns `StoreOperator<A, Store<A> | undefined>` — current window store.
 *
 * @category extra
 */
export function window<A>(notifier: Store<unknown>): StoreOperator<A, Store<A> | undefined> {
	return (input: Store<A>) => {
		const store = producer<Store<A>>(({ emit, error, complete }) => {
			let currentWindow: WritableStore<A> | null = state(input.get());
			let done = false;
			let notifierTalkback: ((type: number) => void) | null = null;

			function openWindow() {
				currentWindow = state<A | undefined>(undefined) as WritableStore<A>;
				emit(currentWindow as Store<A>);
			}

			// Emit the initial window
			emit(currentWindow as Store<A>);

			const inputUnsub = subscribe(
				input,
				(v) => {
					if (currentWindow && !done) {
						currentWindow.set(v);
					}
				},
				{
					onEnd: (err) => {
						if (done) return;
						done = true;
						if (notifierTalkback) {
							notifierTalkback(END);
							notifierTalkback = null;
						}
						if (err !== undefined) {
							error(err);
						} else {
							complete();
						}
					},
				},
			);
			notifier.source(START, (type: number, data: unknown) => {
				if (type === START) notifierTalkback = data as (type: number) => void;
				if (type === 1 && !done) {
					openWindow();
				}
				if (type === END) {
					notifierTalkback = null;
					if (done) return;
					if (data !== undefined) {
						done = true;
						inputUnsub();
						error(data);
					} else {
						done = true;
						inputUnsub();
						complete();
					}
				}
			});

			return () => {
				done = true;
				currentWindow = null;
				if (notifierTalkback) notifierTalkback(END);
				notifierTalkback = null;
				inputUnsub();
			};
		});

		Inspector.register(store, { kind: "window" });
		return store;
	};
}
