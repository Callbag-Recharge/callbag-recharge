import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Maps each upstream value to an inner store via `fn`, subscribing to the new inner
 * and unsubscribing from the previous one. The output reflects the latest inner
 * store's value.
 *
 * Stateful: maintains last inner value via producer. get() returns the current
 * inner store's value (initial + equals prevents spurious initial emission).
 *
 * v3: Tier 2 — dynamic subscription operator. Each inner switch is a cycle
 * boundary; each emit starts a new DIRTY+value cycle. No built-in dedup.
 * Forwards inner errors and upstream completion.
 */
export function switchMap<A, B>(fn: (value: A) => Store<B>): StoreOperator<A, B | undefined> {
	return (outer: Store<A>) => {
		const initialInner = fn(outer.get());
		const store = producer<B>(
			({ emit, error, complete }) => {
				let innerUnsub: (() => void) | null = null;
				let initialized = false;
				let outerDone = false;

				function subscribeInner(innerStore: Store<B>) {
					if (innerUnsub) {
						innerUnsub();
						innerUnsub = null;
					}
					// Skip emit on first connect — producer's { initial } already has the value.
					// On subsequent switches, emit the new inner's current value immediately.
					if (initialized) emit(innerStore.get());
					initialized = true;
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
					// Guard: if inner completed synchronously during subscribe(),
					// onEnd set innerUnsub=null but subscribe's return overwrote it.
					if (innerEnded) innerUnsub = null;
				}

				const outerUnsub = subscribe(
					outer,
					(v) => subscribeInner(fn(v)),
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
				subscribeInner(initialInner);

				return () => {
					if (innerUnsub) innerUnsub();
					outerUnsub();
				};
			},
			{ initial: initialInner.get() },
		);

		Inspector.register(store, { kind: "switchMap" });
		return store;
	};
}
