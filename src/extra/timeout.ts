import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { RESET } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Error thrown when `timeout(ms)` fires because no upstream value arrived in time.
 */
export class TimeoutError extends Error {
	constructor(ms: number) {
		super(`Timeout: source did not emit within ${ms}ms`);
		this.name = "TimeoutError";
	}
}

/**
 * Forwards values while resetting an idle timer; if `ms` passes without DATA, errors with `TimeoutError` (Tier 2).
 *
 * @param ms - Maximum silence before failure.
 *
 * @returns `StoreOperator<A, A>`
 *
 * @category extra
 */
export function timeout<A>(ms: number): StoreOperator<A, A> {
	return (input: Store<A>) => {
		const store = producer<A>(
			({ emit, error, complete, onSignal }) => {
				let timer: ReturnType<typeof setTimeout> | null = null;

				function resetTimer() {
					if (timer !== null) clearTimeout(timer);
					timer = setTimeout(() => {
						timer = null;
						unsub.unsubscribe();
						error(new TimeoutError(ms));
					}, ms);
				}

				const unsub = subscribe(
					input,
					(v) => {
						resetTimer();
						emit(v);
					},
					{
						onEnd: (err) => {
							if (timer !== null) {
								clearTimeout(timer);
								timer = null;
							}
							if (err !== undefined) {
								error(err);
							} else {
								complete();
							}
						},
					},
				);

				resetTimer();

				onSignal((s) => {
					unsub.signal(s);
					if (s === RESET) {
						if (timer !== null) {
							clearTimeout(timer);
							timer = null;
						}
					}
				});

				return () => {
					if (timer !== null) {
						clearTimeout(timer);
						timer = null;
					}
					unsub.unsubscribe();
				};
			},
			{ initial: input.get() },
		);

		Inspector.register(store, { kind: "timeout" });
		return store;
	};
}
