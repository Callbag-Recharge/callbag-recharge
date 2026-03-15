import { Inspector } from "../inspector";
import { producer } from "../producer";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Flattens a store of stores with switch semantics: when the outer store
 * emits a new inner store, unsubscribes from the previous inner and
 * subscribes to the new one.
 *
 * Stateful: maintains last inner value via producer. get() returns the
 * current inner store's value, or undefined if outer is undefined.
 *
 * v3: Tier 2 — dynamic subscription operator. Each inner switch is a cycle
 * boundary; each emit starts a new DIRTY+value cycle. equals: Object.is dedup.
 */
export function flat<T>(): StoreOperator<Store<T> | undefined, T | undefined> {
	return (outer: Store<Store<T> | undefined>) => {
		const initialInner = outer.get();
		const store = producer<T>(
			({ emit }) => {
				let innerUnsub: (() => void) | null = null;

				function subscribeInner(innerStore: Store<T>) {
					if (innerUnsub) {
						innerUnsub();
						innerUnsub = null;
					}
					emit(innerStore.get());
					innerUnsub = subscribe(innerStore, (v) => emit(v));
				}

				const outerUnsub = subscribe(outer, (innerStore) => {
					if (innerStore === undefined) {
						if (innerUnsub) {
							innerUnsub();
							innerUnsub = null;
						}
						emit(undefined as T);
					} else {
						subscribeInner(innerStore);
					}
				});

				if (initialInner !== undefined) {
					subscribeInner(initialInner);
				}

				return () => {
					if (innerUnsub) innerUnsub();
					outerUnsub();
				};
			},
			{ initial: initialInner?.get(), equals: Object.is },
		);

		Inspector.register(store, { kind: "flat" });
		return store;
	};
}
