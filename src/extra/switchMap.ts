import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Maps each upstream value to an inner store via `fn`, subscribing to the new inner
 * and unsubscribing from the previous one. The output reflects the latest inner
 * store's value.
 *
 * v5 (Option D3): Purely reactive — does NOT eagerly evaluate fn(outer.get()) at
 * construction or subscription. Inner subscription is only created when outer emits.
 * get() returns `initial` (if provided) or undefined before first inner emission.
 *
 * Tier 2 — dynamic subscription operator. Each inner switch is a cycle
 * boundary; each emit starts a new DIRTY+value cycle. No built-in dedup.
 * Forwards inner errors and upstream completion.
 */
export function switchMap<A, B>(fn: (value: A) => Store<B>): StoreOperator<A, B | undefined>;
export function switchMap<A, B>(
	fn: (value: A) => Store<B>,
	opts: { initial: B },
): StoreOperator<A, B>;
export function switchMap<A, B>(
	fn: (value: A) => Store<B>,
	opts?: { initial?: B },
): StoreOperator<A, B | undefined> {
	return (outer: Store<A>) => {
		const store = producer<B>(
			({ emit, error, complete }) => {
				let innerUnsub: (() => void) | null = null;
				let outerDone = false;

				function subscribeInner(innerStore: Store<B>) {
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

				const outerUnsub = subscribe(outer, (v) => subscribeInner(fn(v)), {
					onEnd: (err) => {
						if (err !== undefined) {
							error(err);
						} else {
							outerDone = true;
							if (!innerUnsub) complete();
						}
					},
				});

				return () => {
					if (innerUnsub) innerUnsub();
					outerUnsub();
				};
			},
			opts && "initial" in opts ? { initial: opts.initial as B } : undefined,
		);

		Inspector.register(store, { kind: "switchMap" });
		return store;
	};
}
