import { Inspector } from "../inspector";
import { producer } from "../producer";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Maps each upstream value to an inner store via `fn`, subscribing to the new inner
 * and unsubscribing from the previous one. The output reflects the latest inner
 * store's value.
 *
 * Stateful: maintains last inner value via producer. get() returns the current
 * inner store's value (initial + equals prevents spurious initial emission).
 *
 * v3: Tier 2 — dynamic subscription operator. Each inner switch is a cycle
 * boundary; each emit starts a new DIRTY+value cycle. equals: Object.is dedup.
 */
export function switchMap<A, B>(fn: (value: A) => Store<B>): StoreOperator<A, B | undefined> {
	return (outer: Store<A>) => {
		const initialInner = fn(outer.get());
		const store = producer<B>(
			({ emit }) => {
				let innerUnsub: (() => void) | null = null;

				function subscribeInner(innerStore: Store<B>) {
					if (innerUnsub) {
						innerUnsub();
						innerUnsub = null;
					}
					emit(innerStore.get());
					innerUnsub = subscribe(innerStore, (v) => emit(v));
				}

				const outerUnsub = subscribe(outer, (v) => subscribeInner(fn(v)));
				subscribeInner(initialInner);

				return () => {
					if (innerUnsub) innerUnsub();
					outerUnsub();
				};
			},
			{ initial: initialInner.get(), equals: Object.is },
		);

		Inspector.register(store, { kind: "switchMap" });
		return store;
	};
}
