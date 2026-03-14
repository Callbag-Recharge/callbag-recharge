import { beginDeferredStart, DATA, DIRTY, END, endDeferredStart, START } from "../protocol";
import { stream } from "../stream";
import type { Store, StreamStore } from "../types";

/**
 * Merges multiple sources into one. The resulting store's value is the latest
 * emission from whichever source changed most recently.
 */
export function merge<T>(...sources: Store<T>[]): StreamStore<T> {
	return stream<T>((emit, _request, complete) => {
		const talkbacks: Array<((type: number) => void) | null> = [];
		let activeCount = sources.length;

		beginDeferredStart();

		for (const source of sources) {
			const index = talkbacks.length;
			talkbacks.push(null);

			// Read once to trigger lazy upstream connections (e.g. derived stores)
			source.get();

			source.source(START, (type: number, data: unknown) => {
				if (type === START) talkbacks[index] = data as (type: number) => void;
				if (type === DATA && data === DIRTY) {
					emit(source.get());
				}
				if (type === END) {
					talkbacks[index] = null;
					activeCount--;
					if (activeCount === 0) complete();
				}
			});
		}

		endDeferredStart();

		return () => {
			for (const tb of talkbacks) {
				if (tb) tb(END);
			}
		};
	});
}
