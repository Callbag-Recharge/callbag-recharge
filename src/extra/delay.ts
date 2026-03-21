import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { LifecycleSignal } from "../core/protocol";
import { RESET } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Shifts each upstream value forward in time by `ms` (independent timer per value).
 *
 * @param ms - Delay in milliseconds.
 *
 * @returns `StoreOperator<A, A | undefined>` — Tier 2; may reorder rapid bursts by completion time.
 *
 * @seeAlso [debounce](/api/debounce)
 *
 * @category extra
 */
export function delay<A>(ms: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		const store = producer<A>(
			({ emit, error, complete, onSignal }) => {
				const timers = new Set<ReturnType<typeof setTimeout>>();
				let outerSub: ReturnType<typeof subscribe>;

				onSignal((s: LifecycleSignal) => {
					outerSub.signal(s);
					if (s === RESET) {
						for (const id of timers) clearTimeout(id);
						timers.clear();
					}
				});

				outerSub = subscribe(
					input,
					(v) => {
						const id = setTimeout(() => {
							timers.delete(id);
							emit(v);
						}, ms);
						timers.add(id);
					},
					{
						onEnd: (err) => {
							if (err !== undefined) {
								// Error: cancel all pending timers, forward error
								for (const id of timers) clearTimeout(id);
								timers.clear();
								error(err);
							} else {
								// Completion: wait for all pending timers to flush, then complete
								if (timers.size === 0) {
									complete();
								} else {
									// Schedule completion after the last pending timer
									const id = setTimeout(() => {
										timers.delete(id);
										complete();
									}, ms);
									timers.add(id);
								}
							}
						},
					},
				);
				return () => {
					for (const id of timers) clearTimeout(id);
					timers.clear();
					outerSub.unsubscribe();
				};
			},
			{ resetOnTeardown: true },
		);
		Inspector.register(store, { kind: "delay" });
		return store;
	};
}
