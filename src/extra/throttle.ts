import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Emits the first value in a window, then drops further values until `ms` has passed (leading throttle).
 *
 * @param ms - Minimum milliseconds between forwarded values.
 *
 * @returns `StoreOperator<A, A | undefined>` — Tier 2; `undefined` until first emission.
 *
 * @remarks **Completion/errors:** Forwards upstream end and error; clears timers on teardown.
 *
 * @seeAlso [debounce](/api/debounce), [audit](/api/audit)
 *
 * @category extra
 */
export function throttle<A>(ms: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		const store = producer<A>(({ emit, error, complete }) => {
			let timer: ReturnType<typeof setTimeout> | null = null;

			const unsub = subscribe(
				input,
				(v) => {
					if (timer !== null) return; // still within throttle window
					emit(v);
					timer = setTimeout(() => {
						timer = null;
					}, ms);
				},
				{
					onEnd: (err) => {
						if (timer !== null) clearTimeout(timer);
						timer = null;
						if (err !== undefined) {
							error(err);
						} else {
							complete();
						}
					},
				},
			);

			return () => {
				if (timer !== null) clearTimeout(timer);
				unsub();
			};
		});

		Inspector.register(store, { kind: "throttle" });
		return store;
	};
}
