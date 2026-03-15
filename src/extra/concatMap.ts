import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { END, START } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Maps each upstream value to an inner store via `fn`, subscribing sequentially.
 * New outer values are queued while an inner is active; the next queued value is
 * processed when the current inner completes (sends END).
 *
 * Stateful: maintains last inner value via producer. get() returns the current
 * inner store's value. Queue is discarded on teardown.
 *
 * v3: Tier 2 — dynamic subscription operator. Each inner is a cycle boundary;
 * each emit starts a new DIRTY+value cycle. No built-in dedup.
 * Forwards inner errors and upstream completion.
 */
export function concatMap<A, B>(fn: (value: A) => Store<B>): StoreOperator<A, B | undefined> {
	return (outer: Store<A>) => {
		const initialInner = fn(outer.get());
		const store = producer<B>(
			({ emit, error, complete }) => {
				let innerTalkback: ((type: number) => void) | null = null;
				let innerActive = false;
				let outerDone = false;
				const queue: A[] = [];

				function processNext() {
					if (queue.length === 0) {
						innerActive = false;
						if (outerDone) complete();
						return;
					}
					subscribeInner(fn(queue.shift() as A));
				}

				let initialized = false;

				function subscribeInner(innerStore: Store<B>) {
					innerActive = true;
					if (initialized) emit(innerStore.get());
					initialized = true;
					innerStore.source(START, (type: number, data: unknown) => {
						if (type === START) innerTalkback = data as (type: number) => void;
						if (type === 1) emit(data as B);
						if (type === END) {
							innerTalkback = null;
							if (data !== undefined) {
								error(data);
							} else {
								processNext();
							}
						}
					});
				}

				const outerUnsub = subscribe(
					outer,
					(v) => {
						if (!innerActive) {
							subscribeInner(fn(v));
						} else {
							queue.push(v);
						}
					},
					{
						onEnd: (err) => {
							if (err !== undefined) {
								error(err);
							} else {
								outerDone = true;
								if (!innerActive) complete();
							}
						},
					},
				);
				subscribeInner(initialInner);

				return () => {
					if (innerTalkback) innerTalkback(END);
					outerUnsub();
					queue.length = 0;
				};
			},
			{ initial: initialInner.get() },
		);

		Inspector.register(store, { kind: "concatMap" });
		return store;
	};
}
