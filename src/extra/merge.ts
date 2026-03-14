import { beginDeferredStart, DATA, DIRTY, END, endDeferredStart, START } from "../protocol";
import { stream } from "../stream";
import type { Store, StreamStore } from "../types";

/**
 * Merges multiple sources into one. The resulting store's value is the latest
 * emission from whichever source changed most recently.
 */
export function merge<T>(...sources: Store<T>[]): StreamStore<T> {
	return stream<T>((emit) => {
		const talkbacks: Array<(type: number) => void> = [];

		beginDeferredStart();

		for (const source of sources) {
			// Read once to trigger lazy upstream connections (e.g. derived stores)
			source.get();

			source.source(START, (type: number, data: unknown) => {
				if (type === START) talkbacks.push(data as (type: number) => void);
				if (type === DATA && data === DIRTY) {
					emit(source.get());
				}
			});
		}

		endDeferredStart();

		return () => {
			for (const tb of talkbacks) tb(END);
		};
	});
}
