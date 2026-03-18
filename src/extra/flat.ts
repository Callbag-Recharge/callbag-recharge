import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

export function flat<T>(): StoreOperator<Store<T> | undefined, T | undefined>;
export function flat<T>(opts: { initial: T }): StoreOperator<Store<T> | undefined, T>;
/**
 * Flattens `Store<Store<T>>` with switch semantics (same as `switchMap(identity)`).
 *
 * @param opts - Optional `{ initial: T }` to narrow `get()` before the first inner emission.
 *
 * @returns `StoreOperator` — Tier 2; reactive inner subscription on outer DATA only.
 *
 * @seeAlso [switchMap](/api/switchMap)
 *
 * @category extra
 */
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
