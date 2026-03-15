import { Inspector } from "../inspector";
import { producer } from "../producer";
import { subscribe } from "../subscribe";
import type { Store, StoreOperator } from "../types";

/**
 * Errors if the input source does not emit within `ms` milliseconds.
 * The timer resets on each emission. If the timer fires, sinks receive
 * END with a TimeoutError.
 * Tier 2 — each emit starts a new DIRTY+value cycle (autoDirty: true).
 */
export class TimeoutError extends Error {
	constructor(ms: number) {
		super(`Timeout: source did not emit within ${ms}ms`);
		this.name = "TimeoutError";
	}
}

export function timeout<A>(ms: number): StoreOperator<A, A> {
	return (input: Store<A>) => {
		const store = producer<A>(
			({ emit, error }) => {
				let timer: ReturnType<typeof setTimeout> | null = null;

				function resetTimer() {
					if (timer !== null) clearTimeout(timer);
					timer = setTimeout(() => {
						timer = null;
						unsub();
						error(new TimeoutError(ms));
					}, ms);
				}

				const unsub = subscribe(input, (v) => {
					resetTimer();
					emit(v);
				});

				resetTimer();

				return () => {
					if (timer !== null) {
						clearTimeout(timer);
						timer = null;
					}
					unsub();
				};
			},
			{ initial: input.get() },
		);

		Inspector.register(store, { kind: "timeout" });
		return store;
	};
}
