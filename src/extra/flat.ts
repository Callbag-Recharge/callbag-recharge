import { Inspector } from "../inspector";
import { producer } from "../producer";
import type { Store, StoreOperator } from "../types";
import { subscribe } from "./subscribe";

/**
 * Flattens a store of stores with switch semantics: when the outer store
 * emits a new inner store, unsubscribes from the previous inner and
 * subscribes to the new one.
 *
 * Stateful: maintains last inner value via producer. get() returns the
 * current inner store's value, or undefined if outer is undefined.
 *
 * v3: Tier 2 — dynamic subscription operator. Each inner switch is a cycle
 * boundary; each emit starts a new DIRTY+value cycle. No built-in dedup.
 * Forwards inner errors and upstream completion.
 */
export function flat<T>(): StoreOperator<Store<T> | undefined, T | undefined> {
	return (outer: Store<Store<T> | undefined>) => {
		const initialInner = outer.get();
		const store = producer<T>(
			({ emit, error, complete }) => {
				let innerUnsub: (() => void) | null = null;
				let initialized = false;
				let outerDone = false;

				function subscribeInner(innerStore: Store<T>) {
					if (innerUnsub) {
						innerUnsub();
						innerUnsub = null;
					}
					if (initialized) emit(innerStore.get());
					initialized = true;
					innerUnsub = subscribe(innerStore, (v) => emit(v), {
						onEnd: (err) => {
							innerUnsub = null;
							if (err !== undefined) {
								error(err);
							} else if (outerDone) {
								complete();
							}
						},
					});
				}

				const outerUnsub = subscribe(
					outer,
					(innerStore) => {
						if (innerStore === undefined) {
							if (innerUnsub) {
								innerUnsub();
								innerUnsub = null;
							}
							emit(undefined as T);
						} else {
							subscribeInner(innerStore);
						}
					},
					{
						onEnd: (err) => {
							if (err !== undefined) {
								error(err);
							} else {
								outerDone = true;
								if (!innerUnsub) complete();
							}
						},
					},
				);

				if (initialInner !== undefined) {
					subscribeInner(initialInner);
				}

				return () => {
					if (innerUnsub) innerUnsub();
					outerUnsub();
				};
			},
			{ initial: initialInner?.get() },
		);

		Inspector.register(store, { kind: "flat" });
		return store;
	};
}
