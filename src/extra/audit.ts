import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Trailing-edge throttle. When a value arrives, starts a timer.
 * When the timer fires, emits the latest value received during that window.
 * Ignores values that arrive while no timer is running (i.e., after a flush
 * and before the next value).
 *
 * Complements throttle (leading) and debounce (resets timer on each value).
 *
 * Tier 2: each emit starts a new DIRTY+value cycle (autoDirty: true).
 * Forwards upstream completion and errors. On completion, if a timer is
 * pending, the latest value is flushed before completing.
 */
export function audit<A>(ms: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		const store = producer<A>(({ emit, error, complete }) => {
			let timer: ReturnType<typeof setTimeout> | null = null;
			let latestValue: A | undefined;
			let hasValue = false;

			const unsub = subscribe(
				input,
				(v) => {
					latestValue = v;
					hasValue = true;
					if (timer === null) {
						timer = setTimeout(() => {
							timer = null;
							if (hasValue) {
								hasValue = false;
								emit(latestValue as A);
							}
						}, ms);
					}
				},
				{
					onEnd: (err) => {
						if (timer !== null) {
							clearTimeout(timer);
							timer = null;
						}
						if (err !== undefined) {
							error(err);
						} else {
							// Flush pending value on completion
							if (hasValue) {
								hasValue = false;
								emit(latestValue as A);
							}
							complete();
						}
					},
				},
			);

			return () => {
				if (timer !== null) {
					clearTimeout(timer);
					timer = null;
				}
				hasValue = false;
				unsub();
			};
		});

		Inspector.register(store, { kind: "audit" });
		return store;
	};
}
