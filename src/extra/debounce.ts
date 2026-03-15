import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Delays propagation of each upstream change by `ms` milliseconds.
 * If another change arrives before the timer fires, the timer resets.
 *
 * Stateful: maintains last debounced value via producer. get() returns
 * undefined before first emission, then the last debounced value.
 *
 * v3: Tier 2 — each emit starts a new DIRTY+value cycle (autoDirty: true).
 * No built-in dedup — emits every debounced value.
 * On upstream completion, flushes pending value (if any) then completes.
 * On upstream error, cancels pending timer and forwards error.
 */
export function debounce<A>(ms: number): StoreOperator<A, A | undefined> {
	return (input: Store<A>) => {
		const store = producer<A>(
			({ emit, error, complete }) => {
				let timer: ReturnType<typeof setTimeout> | null = null;
				let pendingValue: A | undefined;
				let hasPending = false;

				const unsub = subscribe(
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
					unsub();
				};
			},
		);

		Inspector.register(store, { kind: "debounce" });
		return store;
	};
}
