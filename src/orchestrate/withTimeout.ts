// ---------------------------------------------------------------------------
// withTimeout — timeout as pipe operator
// ---------------------------------------------------------------------------
// Forwards values while resetting an idle timer. If `ms` passes without a
// value, errors with TimeoutError. Tier 2 operator built on producer().
//
// Usage:
//   pipe(source, withTimeout(5000))
// ---------------------------------------------------------------------------

import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { subscribe } from "../core/subscribe";
import type { Store, StoreOperator } from "../core/types";

export class TimeoutError extends Error {
	constructor(ms: number) {
		super(`Timeout: no value within ${ms}ms`);
		this.name = "TimeoutError";
	}
}

/**
 * Forwards values while resetting an idle timer; errors with `TimeoutError` if `ms` passes without a value (Tier 2).
 *
 * @param ms - Maximum silence in milliseconds before failure.
 *
 * @returns `StoreOperator<A, A>` — pipe-compatible operator.
 *
 * @remarks **Tier 2:** Cycle boundary — each forwarded value starts a new DIRTY+value cycle.
 * @remarks **Cleanup:** Timer is cleared on upstream completion, error, or unsubscribe.
 *
 * @example
 * ```ts
 * import { state, pipe } from 'callbag-recharge';
 * import { withTimeout } from 'callbag-recharge/orchestrate';
 *
 * const input = state(0);
 * const guarded = pipe(input, withTimeout(5000));
 * ```
 *
 * @seeAlso [withRetry](./withRetry) — retry on failure, [withBreaker](./withBreaker) — circuit breaker
 *
 * @category orchestrate
 */
export function withTimeout<A>(ms: number): StoreOperator<A, A> {
	return (input: Store<A>) => {
		const store = producer<A>(
			({ emit, error, complete }) => {
				let timer: ReturnType<typeof setTimeout> | null = null;

				function resetTimer() {
					if (timer !== null) clearTimeout(timer);
					timer = setTimeout(() => {
						timer = null;
						unsub();
						error(new TimeoutError(ms));
					}, ms);
				}

				const unsub = subscribe(
					input,
					(v) => {
						resetTimer();
						emit(v);
					},
					{
						onEnd: (err) => {
							if (timer !== null) {
								clearTimeout(timer);
								timer = null;
							}
							if (err !== undefined) error(err);
							else complete();
						},
					},
				);

				resetTimer();

				return () => {
					if (timer !== null) {
						clearTimeout(timer);
						timer = null;
					}
					unsub();
				};
			},
			{ initial: input.get() },
		);

		Inspector.register(store, { kind: "withTimeout" });
		return store;
	};
}
