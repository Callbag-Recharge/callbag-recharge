import { producer } from "../core/producer";
import type { Signal } from "../core/protocol";
import { beginDeferredStart, DATA, END, endDeferredStart, START, STATE } from "../core/protocol";
import type { Store } from "../core/types";

/**
 * Re-subscribes to `factory()` on each **clean** completion; optional `count` caps total rounds (Tier 2).
 *
 * @param factory - Returns a fresh `Store<T>` per subscription.
 * @param count - Max subscription rounds (omit for infinite repeat).
 *
 * @returns `Store<T | undefined>` — errors are **not** retried (use `retry`).
 *
 * @seeAlso [retry](/api/retry)
 *
 * @category extra
 */
export function repeat<T>(factory: () => Store<T>, count?: number): Store<T | undefined> {
	return producer<T | undefined>(
		({ emit, signal, complete, error }) => {
			let subscriptions = 0;
			let currentTalkback: ((type: number) => void) | null = null;
			let looping = false;
			let needsResubscribe = false;

			function subscribeToSource(): void {
				// Trampoline: if we're already inside subscribeToSource (sync
				// completion), set a flag instead of recursing. The outer call's
				// while-loop will pick it up.
				if (looping) {
					needsResubscribe = true;
					return;
				}

				looping = true;
				while (true) {
					needsResubscribe = false;

					if (count !== undefined && subscriptions >= count) {
						complete();
						break;
					}
					subscriptions++;

					const source = factory();

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
							if (data !== undefined) {
								// Upstream errored — propagate, don't retry
								error(data);
							} else {
								subscribeToSource();
							}
						}
					});

					endDeferredStart();

					if (!needsResubscribe) break;
				}
				looping = false;
			}

			subscribeToSource();

			return () => {
				if (currentTalkback) currentTalkback(END);
			};
		},
		{ autoDirty: false },
	);
}
