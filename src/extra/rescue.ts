import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { END, START } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";

/**
 * On upstream error, switches to a fallback store returned by `fn(error)` (Tier 2).
 *
 * @param fn - Maps the error to a replacement `Store<A>`.
 *
 * @returns `StoreOperator<A, A>` — follows primary until error, then the fallback stream.
 *
 * @seeAlso [retry](/api/retry)
 *
 * @category extra
 */
export function rescue<A>(fn: (error: unknown) => Store<A>): StoreOperator<A, A> {
	return (input: Store<A>) => {
		const store = producer<A>(
			({ emit, complete }) => {
				let activeTalkback: ((type: number) => void) | null = null;
				let initialized = false;

				function connectSource(source: Store<A>) {
					if (activeTalkback) {
						activeTalkback(END);
						activeTalkback = null;
					}
					const initial = source.get();
					// Skip emit on first connect — producer's { initial } already has the value.
					if (initialized && initial !== undefined) emit(initial as A);
					initialized = true;
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
			{ initial: input.get() },
		);

		Inspector.register(store, { kind: "rescue" });
		return store;
	};
}
