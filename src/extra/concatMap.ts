import { Inspector } from "../inspector";
import { producer } from "../producer";
import { END, START } from "../protocol";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Maps each upstream value to an inner store via `fn`, subscribing sequentially.
 * New outer values are queued while an inner is active; the next queued value is
 * processed when the current inner completes (sends END).
 * Tier 2 — dynamic subscription operator. Each inner is a cycle boundary.
 */
export function concatMap<A, B>(fn: (value: A) => Store<B>): StoreOperator<A, B | undefined> {
	return (outer: Store<A>) => {
		const initialInner = fn(outer.get());
		const store = producer<B>(
			({ emit }) => {
				let innerTalkback: ((type: number) => void) | null = null;
				let innerActive = false;
				const queue: A[] = [];

				function processNext() {
					if (queue.length === 0) {
						innerActive = false;
						return;
					}
					subscribeInner(fn(queue.shift() as A));
				}

				function subscribeInner(innerStore: Store<B>) {
					innerActive = true;
					emit(innerStore.get());
					innerStore.source(START, (type: number, data: unknown) => {
						if (type === START) innerTalkback = data as (type: number) => void;
						if (type === 1) emit(data as B);
						if (type === END) {
							innerTalkback = null;
							processNext();
						}
					});
				}

				const outerUnsub = subscribe(outer, (v) => {
					if (!innerActive) {
						subscribeInner(fn(v));
					} else {
						queue.push(v);
					}
				});
				subscribeInner(initialInner);

				return () => {
					if (innerTalkback) innerTalkback(END);
					outerUnsub();
					queue.length = 0;
				};
			},
			{ initial: initialInner.get(), equals: Object.is },
		);

		Inspector.register(store, { kind: "concatMap" });
		return store;
	};
}
