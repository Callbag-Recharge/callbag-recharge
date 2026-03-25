// ---------------------------------------------------------------------------
// rawRace — first-to-emit wins, raw callbag operator
// ---------------------------------------------------------------------------
// Subscribes to all sources. First source to emit DATA wins — losers get
// END. Follows winner for all subsequent DATA and END.
// Zero core deps — pure callbag protocol.
// ---------------------------------------------------------------------------

import type { CallbagSource } from "./subscribe";

/**
 * Mirrors the first raw callbag source that emits a value; sends END to
 * the losers and follows the winner thereafter.
 *
 * @param sources - Competing raw callbag sources.
 *
 * @returns A raw callbag source function.
 *
 * @remarks **Empty:** Completes immediately if `sources` is empty.
 * @remarks **Errors:** If a source errors before any DATA, the error propagates.
 * @remarks **Losers:** Errors from non-winner sources after a winner is chosen are silently
 *   dropped (matches `Promise.race` semantics).
 *
 * @category raw
 */
export function rawRace(...sources: CallbagSource[]): CallbagSource {
	return (type: number, sink?: any) => {
		if (type !== 0 /* START */) return;

		if (sources.length === 0) {
			sink(0 /* START */, (_t: number) => {});
			sink(2 /* END */);
			return;
		}

		let winnerIndex = -1;
		let done = false;
		let completedCount = 0;
		const talkbacks: (((type: number, data?: any) => void) | null)[] = new Array(
			sources.length,
		).fill(null);

		function cleanup(exceptIndex: number) {
			for (let i = 0; i < talkbacks.length; i++) {
				if (i !== exceptIndex && talkbacks[i]) {
					talkbacks[i]!(2 /* END */);
					talkbacks[i] = null;
				}
			}
		}

		// Outer talkback: sink can send END to cancel all, or pull from winner
		sink(0 /* START */, (t: number, d?: any) => {
			if (t === 2 /* END */ && !done) {
				done = true;
				cleanup(-1);
			} else if (winnerIndex !== -1 && talkbacks[winnerIndex]) {
				// Forward non-END signals (e.g. pull requests) to winner
				talkbacks[winnerIndex]!(t, d);
			}
		});

		for (let i = 0; i < sources.length; i++) {
			if (done) break;
			const idx = i;
			sources[idx](0 /* START */, function (this: any, t: number, ...rest: any[]) {
				const d = rest[0];
				const hasPayload = rest.length > 0;

				if (t === 0 /* START */) {
					talkbacks[idx] = d as (type: number, data?: any) => void;
					// If a winner was already chosen (sync emit during wiring),
					// immediately disconnect this loser.
					if (winnerIndex !== -1 && winnerIndex !== idx) {
						talkbacks[idx]!(2 /* END */);
						talkbacks[idx] = null;
					}
					return;
				}
				if (t === 1 /* DATA */) {
					if (done) return;
					if (winnerIndex === -1) {
						winnerIndex = idx;
						cleanup(idx);
					}
					if (winnerIndex === idx) {
						sink(1 /* DATA */, d);
					}
					return;
				}
				if (t === 2 /* END */) {
					talkbacks[idx] = null;
					if (done) return;
					if (hasPayload) {
						// Error — propagate if no winner yet or this is the winner
						if (winnerIndex === -1 || winnerIndex === idx) {
							done = true;
							cleanup(-1);
							sink(2 /* END */, d);
						}
					} else {
						// Clean completion
						if (winnerIndex === idx) {
							done = true;
							sink(2 /* END */);
						} else if (winnerIndex === -1) {
							completedCount++;
							if (completedCount === sources.length) {
								done = true;
								sink(2 /* END */);
							}
						}
					}
				}
			});
		}
	};
}
