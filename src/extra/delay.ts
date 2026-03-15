import { Inspector } from "../inspector";
import { producer } from "../producer";
import type { Store, StoreOperator } from "../types";
import { subscribe } from "./subscribe";

/**
 * Delays each upstream value by `ms` milliseconds.
 * Unlike debounce, each value gets its own independent timer.
 *
 * Stateful: maintains last delayed value via producer. get() returns
 * undefined before first emission and after teardown (resetOnTeardown).
 *
 * v3: Tier 2 — each emit starts a new DIRTY+value cycle (autoDirty: true).
 * No equals — every delayed value is forwarded faithfully.
 */
export function delay<A>(ms: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		const store = producer<A>(
			({ emit }) => {
				const timers = new Set<ReturnType<typeof setTimeout>>();
				const unsub = subscribe(input, (v) => {
					const id = setTimeout(() => {
						timers.delete(id);
						emit(v);
					}, ms);
					timers.add(id);
				});
				return () => {
					for (const id of timers) clearTimeout(id);
					timers.clear();
					unsub();
				};
			},
			{ resetOnTeardown: true },
		);
		Inspector.register(store, { kind: "delay" });
		return store;
	};
}
