import { Inspector } from "../inspector";
import { producer } from "../producer";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Passes the first upstream change through immediately, then silences further
 * changes for `ms` milliseconds. Leading-edge semantics.
 * Tier 2 — each emit starts a new DIRTY+value cycle (autoDirty: true).
 */
export function throttle<A>(ms: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		const store = producer<A>(
			({ emit }) => {
				let timer: ReturnType<typeof setTimeout> | null = null;

				const unsub = subscribe(input, (v) => {
					if (timer !== null) return; // still within throttle window
					emit(v);
					timer = setTimeout(() => {
						timer = null;
					}, ms);
				});

				return () => {
					if (timer !== null) clearTimeout(timer);
					unsub();
				};
			},
			{ equals: Object.is },
		);

		Inspector.register(store, { kind: "throttle" });
		return store;
	};
}
