import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Trailing-edge sample: after a value arrives, waits `ms` then emits the **latest** value seen in that window (Tier 2).
 *
 * @param ms - Silence period before emitting the most recent upstream value.
 *
 * @returns `StoreOperator<A, A | undefined>`
 *
 * @seeAlso [throttle](/api/throttle), [sample](/api/sample)
 *
 * @category extra
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
