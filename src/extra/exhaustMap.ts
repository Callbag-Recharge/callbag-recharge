import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { LifecycleSignal } from "../core/protocol";
import { END, RESET, START } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

export function exhaustMap<A, B>(fn: (value: A) => Store<B>): StoreOperator<A, B | undefined>;
export function exhaustMap<A, B>(
	fn: (value: A) => Store<B>,
	opts: { initial: B },
): StoreOperator<A, B>;
/**
 * Like `switchMap`, but **ignores** new outer values until the current inner completes.
 *
 * @param fn - Inner store factory.
 * @param opts - Optional `{ initial: B }`.
 *
 * @returns `StoreOperator` — Tier 2.
 *
 * @seeAlso [switchMap](/api/switchMap), [concatMap](/api/concatMap)
 *
 * @category extra
 */
export function exhaustMap<A, B>(
	fn: (value: A) => Store<B>,
	opts?: { initial?: B },
): StoreOperator<A, B | undefined> {
	return (outer: Store<A>) => {
		const store = producer<B>(
			({ emit, error, complete, onSignal }) => {
				let innerTalkback: ((type: number) => void) | null = null;
				let innerActive = false;
				let outerDone = false;

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
								innerActive = false;
								if (outerDone) complete();
							}
						}
					});
				}

				let outerSub: ReturnType<typeof subscribe>;

				onSignal((s: LifecycleSignal) => {
					outerSub.signal(s);
					if (s === RESET) {
						if (innerTalkback) {
							innerTalkback(END);
							innerTalkback = null;
						}
						innerActive = false;
						outerDone = false;
					}
				});

				outerSub = subscribe(
					outer,
					(v) => {
						if (!innerActive) subscribeInner(fn(v));
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
					outerSub.unsubscribe();
				};
			},
			opts && "initial" in opts ? { initial: opts.initial as B } : undefined,
		);

		Inspector.register(store, { kind: "exhaustMap" });
		return store;
	};
}
