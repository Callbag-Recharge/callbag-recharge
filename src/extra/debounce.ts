import { Inspector } from "../inspector";
import { producer } from "../producer";
import type { Store, StoreOperator } from "../types";
import { subscribe } from "./subscribe";

/**
 * Delays propagation of each upstream change by `ms` milliseconds.
 * If another change arrives before the timer fires, the timer resets.
 *
 * Stateful: maintains last debounced value via producer. get() returns
 * undefined before first emission, then the last debounced value.
 *
 * v3: Tier 2 — each emit starts a new DIRTY+value cycle (autoDirty: true).
 * equals: Object.is dedup on emitted values.
 */
export function debounce<A>(ms: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		const store = producer<A>(
			({ emit }) => {
				let timer: ReturnType<typeof setTimeout> | null = null;
				let pendingValue: A | undefined;

				const unsub = subscribe(input, (v) => {
					if (timer !== null) clearTimeout(timer);
					pendingValue = v;
					timer = setTimeout(() => {
						timer = null;
						emit(pendingValue as A);
					}, ms);
				});

				return () => {
					if (timer !== null) clearTimeout(timer);
					unsub();
				};
			},
			{ equals: Object.is },
		);

		Inspector.register(store, { kind: "debounce" });
		return store;
	};
}
