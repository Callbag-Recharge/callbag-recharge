import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { beginDeferredStart, END, endDeferredStart, START } from "../core/protocol";
import type { Store } from "../core/types";

/**
 * Emits from whichever source fires first, then unsubscribes from all others.
 * After the winner is determined, all subsequent values come from that source only.
 *
 * Tier 2: each emit starts a new DIRTY+value cycle (autoDirty: true).
 *
 * If a source errors before any source emits, the error is forwarded.
 * If all sources complete without emitting, the race completes.
 *
 * Uses deferStart batching to ensure all sources are wired before any emits,
 * preventing unfair advantage for earlier sources in the array.
 */
export function race<T>(...sources: Store<T>[]): Store<T | undefined> {
	const store = producer<T>(
		({ emit, error, complete }) => {
			if (sources.length === 0) {
				complete();
				return undefined;
			}

			let winnerIndex = -1;
			let done = false;
			let completedCount = 0;
			const talkbacks: (((type: number) => void) | null)[] = new Array(sources.length).fill(null);

			function cleanup(exceptIndex: number) {
				for (let i = 0; i < talkbacks.length; i++) {
					if (i !== exceptIndex && talkbacks[i]) {
						talkbacks[i]!(END);
						talkbacks[i] = null;
					}
				}
			}

			beginDeferredStart();

			for (let i = 0; i < sources.length; i++) {
				const idx = i;
				sources[idx].source(START, (type: number, data: unknown) => {
					if (type === START) {
						talkbacks[idx] = data as (type: number) => void;
						// If a winner was already chosen (sync emit during deferred start),
						// immediately disconnect this loser.
						if (winnerIndex !== -1 && winnerIndex !== idx) {
							talkbacks[idx]!(END);
							talkbacks[idx] = null;
						}
						return;
					}
					if (type === 1) {
						if (done) return;
						if (winnerIndex === -1) {
							winnerIndex = idx;
							cleanup(idx);
						}
						if (winnerIndex === idx) {
							emit(data as T);
						}
					}
					if (type === END) {
						talkbacks[idx] = null;
						if (done) return;
						if (data !== undefined) {
							// Error
							if (winnerIndex === -1 || winnerIndex === idx) {
								done = true;
								cleanup(-1);
								error(data);
							}
						} else {
							if (winnerIndex === idx) {
								done = true;
								complete();
							} else if (winnerIndex === -1) {
								completedCount++;
								if (completedCount === sources.length) {
									done = true;
									complete();
								}
							}
						}
					}
				});
			}

			endDeferredStart();

			return () => {
				done = true;
				cleanup(-1);
			};
		},
		{ resubscribable: true },
	);

	Inspector.register(store, { kind: "race" });
	return store;
}
