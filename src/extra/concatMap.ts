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
 * v5 (Option D3): Purely reactive — does NOT eagerly evaluate fn(outer.get()).
 * Inner subscription is only created when outer emits. get() returns `initial`
 * (if provided) or undefined before first inner emission.
 *
 * Tier 2 — dynamic subscription operator. Each inner is a cycle boundary;
 * each emit starts a new DIRTY+value cycle. No built-in dedup.
 * Forwards inner errors and upstream completion.
 *
 * `maxBuffer` limits queued outer values. When exceeded, oldest queued values
 * are dropped (backpressure). Default: no limit.
 */
export function concatMap<A, B>(fn: (value: A) => Store<B>): StoreOperator<A, B | undefined>;
export function concatMap<A, B>(
	fn: (value: A) => Store<B>,
	opts: { initial: B; maxBuffer?: number },
): StoreOperator<A, B>;
export function concatMap<A, B>(
	fn: (value: A) => Store<B>,
	opts?: { initial?: B; maxBuffer?: number },
): StoreOperator<A, B | undefined> {
	return (outer: Store<A>) => {
		const store = producer<B>(
			({ emit, error, complete }) => {
				let innerTalkback: ((type: number) => void) | null = null;
				let innerActive = false;
				let outerDone = false;
				const queue: A[] = [];
				const maxBuffer = opts?.maxBuffer ?? Infinity;

				function processNext() {
					if (queue.length === 0) {
						innerActive = false;
						if (outerDone) complete();
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
							if (queue.length >= maxBuffer) queue.shift();
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

				return () => {
					if (innerTalkback) innerTalkback(END);
					outerUnsub();
					queue.length = 0;
				};
			},
			opts && "initial" in opts ? { initial: opts.initial as B } : undefined,
		);

		Inspector.register(store, { kind: "concatMap" });
		return store;
	};
}
