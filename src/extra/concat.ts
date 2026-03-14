import { producer } from "../producer";
import type { Signal } from "../protocol";
import { beginDeferredStart, DATA, END, endDeferredStart, START, STATE } from "../protocol";
import type { Store } from "../types";

/**
 * Concatenates multiple sources sequentially. Subscribes to the next source
 * only after the current one completes.
 *
 * Stateful: maintains last emitted value via producer's internal cache.
 * get() returns the last value emitted by the currently active source.
 *
 * v3: uses producer(autoDirty:false) — a Tier 2 boundary rather than Tier 1
 * operator(), because sequential subscription (one active dep at a time) does
 * not fit operator()'s static multi-dep model. Type 3 STATE signals from the
 * active source are forwarded manually; type 1 DATA is emitted directly
 * without auto-DIRTY (since DIRTY already arrived via type 3).
 */
export function concat<T>(...sources: Store<T>[]): Store<T | undefined> {
	return producer<T | undefined>(
		({ emit, signal, complete }) => {
			let index = 0;
			let currentTalkback: ((type: number) => void) | null = null;

			function subscribeNext() {
				if (index >= sources.length) {
					complete();
					return;
				}

				const source = sources[index++];

				beginDeferredStart();

				source.source(START, (type: number, data: unknown) => {
					if (type === START) {
						currentTalkback = data as (t: number) => void;
						return;
					}
					if (type === STATE) {
						signal(data as Signal);
					}
					if (type === DATA) {
						emit(data as T);
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
		},
		{ autoDirty: false },
	);
}
