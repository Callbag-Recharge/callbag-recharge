import { producer } from "../core/producer";
import type { LifecycleSignal, Signal } from "../core/protocol";
import { beginDeferredStart, DATA, END, endDeferredStart, START, STATE } from "../core/protocol";
import type { Store } from "../core/types";

/**
 * Plays sources one after another: the next source subscribes only after the previous completes.
 *
 * @param sources - Ordered list of `Store<T>`.
 *
 * @returns `Store<T | undefined>` — Tier 2; value is from whichever source is currently active.
 *
 * @remarks **STATE:** Forwards control signals from the active source only.
 *
 * @seeAlso [merge](/api/merge), [concatMap](/api/concatMap)
 *
 * @category extra
 */
export function concat<T>(...sources: Store<T>[]): Store<T | undefined> {
	return producer<T | undefined>(
		({ emit, signal, complete, error, onSignal }) => {
			let index = 0;
			let currentTalkback: ((type: number, data?: any) => void) | null = null;

			function subscribeNext() {
				if (index >= sources.length) {
					complete();
					return;
				}

				const source = sources[index++];

				beginDeferredStart();

				source.source(START, (type: number, data: unknown) => {
					if (type === START) {
						currentTalkback = data as (t: number, d?: any) => void;
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
						if (data !== undefined) {
							error(data);
						} else {
							subscribeNext();
						}
					}
				});

				endDeferredStart();
			}

			subscribeNext();

			onSignal((s: LifecycleSignal) => {
				if (currentTalkback) currentTalkback(STATE, s);
			});

			return () => {
				if (currentTalkback) currentTalkback(END);
			};
		},
		{ autoDirty: false },
	);
}
