import {
	DATA,
	DIRTY,
	END,
	START,
	beginDeferredStart,
	endDeferredStart,
} from "../protocol";
import { stream } from "../stream";
import type { Store, StreamStore } from "../types";

/**
 * Concatenates multiple sources sequentially. Subscribes to the next source
 * only after the current one completes.
 */
export function concat<T>(...sources: Store<T>[]): StreamStore<T> {
	return stream<T>((emit, _request, complete) => {
		let index = 0;
		let currentTalkback: ((type: number) => void) | null = null;

		function subscribeNext() {
			if (index >= sources.length) {
				complete();
				return;
			}

			const source = sources[index++];

			beginDeferredStart();

			source.get(); // trigger lazy upstream

			source.source(START, (type: number, data: unknown) => {
				if (type === START) {
					currentTalkback = data as (type: number) => void;
				}
				if (type === DATA && data === DIRTY) {
					emit(source.get());
				}
				if (type === END) {
					currentTalkback = null;
					subscribeNext();
				}
			});

			endDeferredStart();
		}

		subscribeNext();

		return () => {
			if (currentTalkback) currentTalkback(END);
		};
	});
}
