import { producer } from "../core/producer";
import type { Signal } from "../core/protocol";
import { beginDeferredStart, DATA, END, endDeferredStart, START, STATE } from "../core/protocol";
import type { Store } from "../core/types";

/**
 * Creates a source that subscribes to the source returned by `factory`,
 * and re-subscribes on normal completion, up to `count` total subscriptions.
 * Each repetition creates a fresh source via the factory function.
 *
 * `repeat(factory, 3)` subscribes at most 3 times total.
 * `repeat(factory)` with no count repeats indefinitely.
 *
 * Error propagation: if an inner source errors (END with data), the error
 * is forwarded immediately — repeat does NOT re-subscribe on error
 * (use `retry` for that).
 *
 * Stack safety: re-subscription is deferred via a trampoline to prevent
 * stack overflow when inner sources complete synchronously.
 *
 * Stateful: maintains last emitted value via producer's internal cache.
 * get() returns the last value emitted by any subscription round.
 *
 * v3: uses producer(autoDirty:false) — a Tier 2 boundary. Type 3 STATE
 * signals from the active subscription are forwarded manually; type 1 DATA
 * is emitted directly without auto-DIRTY (since DIRTY already arrived via
 * type 3). On upstream END, creates a new source via factory and subscribes
 * if repetitions remain. Tests verify previous-subscription disposal.
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
