import { Inspector } from "../inspector";
import { producer } from "../producer";
import { END, START } from "../protocol";
import type { Store, StoreOperator } from "../types";

/**
 * Error recovery operator. When the input source errors, calls `fn` with
 * the error and subscribes to the returned fallback source.
 *
 * Stateful: maintains last value via producer. get() returns input's initial
 * value before first emission, then the latest value from active source.
 *
 * v3: Tier 2 — dynamic subscription operator. Each emit starts a new
 * DIRTY+value cycle. equals: Object.is dedup. Uses raw callbag for END
 * detection (error vs clean completion).
 */
export function rescue<A>(fn: (error: unknown) => Store<A>): StoreOperator<A, A> {
	return (input: Store<A>) => {
		const store = producer<A>(
			({ emit, complete }) => {
				let activeTalkback: ((type: number) => void) | null = null;

				function connectSource(source: Store<A>) {
					if (activeTalkback) {
						activeTalkback(END);
						activeTalkback = null;
					}
					const initial = source.get();
					if (initial !== undefined) emit(initial as A);
					source.source(START, (type: number, data: unknown) => {
						if (type === START) activeTalkback = data as (type: number) => void;
						if (type === 1) emit(data as A);
						if (type === END) {
							activeTalkback = null;
							if (data !== undefined) {
								connectSource(fn(data));
							} else {
								complete();
							}
						}
					});
				}

				connectSource(input);

				return () => {
					if (activeTalkback) activeTalkback(END);
				};
			},
			{ initial: input.get(), equals: Object.is },
		);

		Inspector.register(store, { kind: "rescue" });
		return store;
	};
}
