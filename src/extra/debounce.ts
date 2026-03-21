import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { LifecycleSignal } from "../core/protocol";
import { RESET } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Delays each upstream change by `ms`; resets the timer if another value arrives sooner (leading-edge cancel).
 *
 * @param ms - Debounce interval in milliseconds.
 *
 * @returns `StoreOperator<A, A | undefined>` — `undefined` until the first debounced emission; flushes pending on upstream complete.
 *
 * @remarks **Tier 2:** Cycle boundary; each debounced `emit` is its own DIRTY+DATA cycle.
 * @remarks **Errors:** Cancels the timer and forwards upstream errors.
 *
 * @example
 * ```ts
 * import { state, pipe } from 'callbag-recharge';
 * import { debounce } from 'callbag-recharge/extra';
 *
 * const q = state('');
 * const d = pipe(q, debounce(100));
 * q.set('hi');
 * // after 100ms idle, d emits 'hi'
 * ```
 *
 * @seeAlso [throttle](/api/throttle) — rate-limit emissions, [audit](/api/audit) — sample after silence
 *
 * @category extra
 */
export function debounce<A>(ms: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		const store = producer<A>(({ emit, error, complete, onSignal }) => {
			let timer: ReturnType<typeof setTimeout> | null = null;
			let pendingValue: A | undefined;
			let hasPending = false;
			let outerSub: ReturnType<typeof subscribe>;

			onSignal((s: LifecycleSignal) => {
				outerSub.signal(s);
				if (s === RESET) {
					if (timer !== null) {
						clearTimeout(timer);
						timer = null;
					}
					hasPending = false;
					pendingValue = undefined;
				}
			});

			outerSub = subscribe(
				input,
				(v) => {
					if (timer !== null) clearTimeout(timer);
					pendingValue = v;
					hasPending = true;
					timer = setTimeout(() => {
						timer = null;
						hasPending = false;
						emit(pendingValue as A);
					}, ms);
				},
				{
					onEnd: (err) => {
						if (err !== undefined) {
							if (timer !== null) clearTimeout(timer);
							timer = null;
							error(err);
						} else {
							// Flush pending value on completion (rxjs semantics)
							if (timer !== null) {
								clearTimeout(timer);
								timer = null;
							}
							if (hasPending) {
								hasPending = false;
								emit(pendingValue as A);
							}
							complete();
						}
					},
				},
			);

			return () => {
				if (timer !== null) clearTimeout(timer);
				outerSub.unsubscribe();
			};
		});

		Inspector.register(store, { kind: "debounce" });
		return store;
	};
}
