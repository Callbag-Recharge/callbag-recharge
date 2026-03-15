import { Inspector } from "../inspector";
import { producer } from "../producer";
import { END, START } from "../protocol";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Maps each upstream value to an inner store via `fn`. While an inner is active,
 * new outer values are ignored. The next outer value is accepted only after the
 * current inner completes (sends END).
 *
 * Stateful: maintains last inner value via producer. get() returns the current
 * inner store's value.
 *
 * v3: Tier 2 — dynamic subscription operator. Each inner is a cycle boundary;
 * each emit starts a new DIRTY+value cycle. equals: Object.is dedup.
 */
export function exhaustMap<A, B>(fn: (value: A) => Store<B>): StoreOperator<A, B | undefined> {
	return (outer: Store<A>) => {
		const initialInner = fn(outer.get());
		const store = producer<B>(
			({ emit }) => {
				let innerTalkback: ((type: number) => void) | null = null;
				let innerActive = false;

				function subscribeInner(innerStore: Store<B>) {
					innerActive = true;
					emit(innerStore.get());
					innerStore.source(START, (type: number, data: unknown) => {
						if (type === START) innerTalkback = data as (type: number) => void;
						if (type === 1) emit(data as B);
						if (type === END) {
							innerTalkback = null;
							innerActive = false;
						}
					});
				}

				const outerUnsub = subscribe(outer, (v) => {
					if (!innerActive) subscribeInner(fn(v));
				});
				subscribeInner(initialInner);

				return () => {
					if (innerTalkback) innerTalkback(END);
					outerUnsub();
				};
			},
			{ initial: initialInner.get(), equals: Object.is },
		);

		Inspector.register(store, { kind: "exhaustMap" });
		return store;
	};
}
