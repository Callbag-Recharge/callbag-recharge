import { Inspector } from "../inspector";
import { producer } from "../producer";
import { END, START } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Re-subscribes to the input source up to `n` times on error (END with error).
 *
 * Stateful: maintains last value via producer. get() returns input's initial
 * value before first emission, then the latest value from the source.
 *
 * v3: Tier 2 — dynamic subscription operator. Each emit starts a new
 * DIRTY+value cycle. No built-in dedup. Uses raw callbag for END
 * detection (error triggers reconnect, clean completion propagates).
 */
export function retry<A>(n: number): StoreOperator<A, A> {
	return (input: Store<A>) => {
		const store = producer<A>(
			({ emit, complete, error }) => {
				let retriesLeft = n;
				let inputTalkback: ((type: number) => void) | null = null;
				let initialized = false;

				function connectInput() {
					if (inputTalkback) {
						inputTalkback(END);
						inputTalkback = null;
					}
					const initial = input.get();
					// Skip emit on first connect — producer's { initial } already has the value.
					// On retry (reconnect after error), emit to update the output value.
					if (initialized && initial !== undefined) emit(initial as A);
					initialized = true;
					input.source(START, (type: number, data: unknown) => {
						if (type === START) inputTalkback = data as (type: number) => void;
						if (type === 1) emit(data as A);
						if (type === END) {
							inputTalkback = null;
							if (data !== undefined && retriesLeft > 0) {
								retriesLeft--;
								connectInput();
							} else if (data !== undefined) {
								error(data);
							} else {
								complete();
							}
						}
					});
				}

				connectInput();

				return () => {
					if (inputTalkback) inputTalkback(END);
				};
			},
			{ initial: input.get() },
		);

		Inspector.register(store, { kind: "retry" });
		return store;
	};
}
