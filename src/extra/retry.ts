import { Inspector } from "../inspector";
import { producer } from "../producer";
import { END, START } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Re-subscribes to the input source up to `n` times on error (END with error).
 * Tier 2 — dynamic subscription operator (autoDirty: false, manual signal control).
 */
export function retry<A>(n: number): StoreOperator<A, A> {
	return (input: Store<A>) => {
		const store = producer<A>(
			({ emit, complete, error }) => {
				let retriesLeft = n;
				let inputTalkback: ((type: number) => void) | null = null;

				function connectInput() {
					if (inputTalkback) {
						inputTalkback(END);
						inputTalkback = null;
					}
					const initial = input.get();
					if (initial !== undefined) emit(initial as A);
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
			{ initial: input.get(), equals: Object.is },
		);

		Inspector.register(store, { kind: "retry" });
		return store;
	};
}
