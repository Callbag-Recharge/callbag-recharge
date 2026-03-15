import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import type { Store, StoreOperator } from "../core/types";
import { subscribe } from "./subscribe";

/**
 * Errors if the input source does not emit within `ms` milliseconds.
 * The timer resets on each emission. If the timer fires, sinks receive
 * END with a TimeoutError.
 *
 * Stateful: maintains last forwarded value via producer. get() returns
 * input's initial value before first emission.
 *
 * v3: Tier 2 — each emit starts a new DIRTY+value cycle (autoDirty: true).
 * No equals — every upstream value is forwarded to keep the timer alive.
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
			({ emit, error, complete }) => {
				let timer: ReturnType<typeof setTimeout> | null = null;

				function resetTimer() {
					if (timer !== null) clearTimeout(timer);
					timer = setTimeout(() => {
						timer = null;
						unsub();
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
