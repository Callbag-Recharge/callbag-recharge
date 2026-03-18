import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Flattens a store of stores with switch semantics: when the outer store
 * emits a new inner store, unsubscribes from the previous inner and
 * subscribes to the new one.
 *
 * v5 (Option D3): Purely reactive — does NOT eagerly evaluate outer.get()
 * at construction. Inner subscription is only created when outer emits.
 * get() returns undefined before first inner emission.
 *
 * Tier 2 — dynamic subscription operator. Each inner switch is a cycle
 * boundary; each emit starts a new DIRTY+value cycle. No built-in dedup.
 * Forwards inner errors and upstream completion.
 */
export function flat<T>(): StoreOperator<Store<T> | undefined, T | undefined>;
export function flat<T>(opts: { initial: T }): StoreOperator<Store<T> | undefined, T>;
export function flat<T>(opts?: {
	initial?: T;
}): StoreOperator<Store<T> | undefined, T | undefined> {
	return (outer: Store<Store<T> | undefined>) => {
		const store = producer<T>(
			({ emit, error, complete }) => {
				let innerUnsub: (() => void) | null = null;
				let outerDone = false;

				function subscribeInner(innerStore: Store<T>) {
					if (innerUnsub) {
						innerUnsub();
						innerUnsub = null;
					}
					emit(innerStore.get());
					let innerEnded = false;
					innerUnsub = subscribe(innerStore, (v) => emit(v), {
						onEnd: (err) => {
							innerUnsub = null;
							innerEnded = true;
							if (err !== undefined) {
								error(err);
							} else if (outerDone) {
								complete();
							}
						},
					});
					if (innerEnded) innerUnsub = null;
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

				return () => {
					if (innerUnsub) innerUnsub();
					outerUnsub();
				};
			},
			opts && "initial" in opts ? { initial: opts.initial as T } : undefined,
		);

		Inspector.register(store, { kind: "flat" });
		return store;
	};
}
