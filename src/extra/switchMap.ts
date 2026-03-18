import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

export function switchMap<A, B>(fn: (value: A) => Store<B>): StoreOperator<A, B | undefined>;
export function switchMap<A, B>(
	fn: (value: A) => Store<B>,
	opts: { initial: B },
): StoreOperator<A, B>;
/**
 * Maps each outer value to an inner `Store`, subscribes to the latest inner, and unsubscribes from the previous.
 * Reactive only: inner stores are created when the outer emits, not from `fn(outer.get())` at build time.
 *
 * @param fn - Factory for the inner store from each outer value.
 * @param opts - Pass `{ initial: B }` to narrow the output type and seed `get()` before the first inner value.
 *
 * @returns `StoreOperator<A, B | undefined>` (or `B` when `initial` is set).
 *
 * @remarks **Tier 2:** Each switch starts a new reactive cycle.
 * @remarks **Streaming:** Until first outer emission, output may be `undefined` unless `initial` is provided.
 *
 * @example
 * ```ts
 * import { state, pipe, producer } from 'callbag-recharge';
 * import { switchMap } from 'callbag-recharge/extra';
 *
 * const outer = state('a');
 * const out = pipe(
 *   outer,
 *   switchMap((x) => producer<string>(({ emit }) => { emit(x + '!'); })),
 * );
 * ```
 *
 * @seeAlso [concatMap](/api/concatMap) — queue inner subscriptions, [exhaustMap](/api/exhaustMap) — ignore while active, [flat](/api/flat) — flatten all inner sources
 *
 * @category extra
 */
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
