import { Inspector } from "../inspector";
import { producer } from "../producer";
import type { Store, StoreOperator } from "../types";
import { subscribe } from "./subscribe";

/**
 * Passes the first upstream change through immediately, then silences further
 * changes for `ms` milliseconds. Leading-edge semantics.
 *
 * Stateful: maintains last throttled value via producer. get() returns
 * undefined before first emission, then the last passed-through value.
 *
 * v3: Tier 2 — each emit starts a new DIRTY+value cycle (autoDirty: true).
 * equals: Object.is dedup on emitted values.
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
