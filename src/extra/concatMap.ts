import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { END, START } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

export function concatMap<A, B>(fn: (value: A) => Store<B>): StoreOperator<A, B | undefined>;
export function concatMap<A, B>(
	fn: (value: A) => Store<B>,
	opts: { initial: B; maxBuffer?: number },
): StoreOperator<A, B>;
/**
 * Maps each outer value to an inner store and runs inners **sequentially** (queue while busy).
 *
 * @param fn - Inner store factory.
 * @param opts - `{ initial: B }` narrows type; `maxBuffer` drops oldest queued outers when exceeded (default: unlimited).
 *
 * @returns `StoreOperator<A, B | undefined>` or `B` with `initial`.
 *
 * @remarks **Tier 2:** Reactive; no eager `fn(outer.get())`.
 *
 * @seeAlso [switchMap](/api/switchMap), [exhaustMap](/api/exhaustMap)
 *
 * @category extra
 */
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
