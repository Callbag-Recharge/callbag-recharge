// ---------------------------------------------------------------------------
// withRetry — retry + backoff as pipe operator with observable retry state
// ---------------------------------------------------------------------------
// Re-subscribes to the input after errors, with optional count limit, backoff,
// and predicate. Exposes retry metadata as a reactive store. Tier 2 operator
// built on producer().
//
// Usage:
//   import { exponential } from 'callbag-recharge/utils';
//   pipe(source, withRetry({ count: 3, delay: exponential(1000) }))
// ---------------------------------------------------------------------------

import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { END, START } from "../core/protocol";
import { state } from "../core/state";
import type { Store, StoreOperator } from "../core/types";

/** Delay strategy: returns ms to wait, or null to stop. */
export type DelayStrategy = (attempt: number, error?: unknown, prevDelay?: number) => number | null;

export interface WithRetryOptions {
	/** Maximum number of retries. Default: 3. */
	count?: number;
	/** Backoff strategy — returns ms to wait, or null to stop. */
	delay?: DelayStrategy;
	/** Predicate — retry only if this returns true for the error. */
	while?: (error: unknown) => boolean;
}

export interface RetryMeta {
	/** Current attempt number (0 = first try, 1 = first retry, etc.) */
	attempt: number;
	/** Last error that triggered a retry, or undefined. */
	lastError?: unknown;
	/** Whether a retry is currently pending (delayed). */
	pending: boolean;
}

/**
 * Re-subscribes to the input after errors with observable retry state (Tier 2).
 *
 * @param config - Shorthand `number` (max retries) or full options object.
 *
 * @returns `StoreOperator<A, A>` — pipe-compatible. The returned store has a `retryMeta` property (`Store<RetryMeta>`).
 *
 * @remarks **Tier 2:** Cycle boundary — each forwarded value starts a new DIRTY+value cycle.
 * @remarks **Observable state:** `retryMeta` store tracks attempt count, last error, and pending status reactively.
 * @remarks **Pluggable delay:** Accepts any `(attempt, error?, prevDelay?) => number | null` function (e.g. backoff strategies from utils).
 *
 * @example
 * ```ts
 * import { state, pipe } from 'callbag-recharge';
 * import { withRetry } from 'callbag-recharge/orchestrate';
 *
 * const input = state(0);
 * const resilient = pipe(input, withRetry({ count: 3 }));
 * ```
 *
 * @seeAlso [withTimeout](./withTimeout) — timeout guard, [withBreaker](./withBreaker) — circuit breaker
 *
 * @category orchestrate
 */
export function withRetry<A>(config: number | WithRetryOptions): StoreOperator<A, A> {
	const opts: WithRetryOptions = typeof config === "number" ? { count: config } : config;
	const maxRetries = opts.count ?? 3;
	const delayFn = opts.delay ?? null;
	const whileFn = opts.while ?? null;

	return (input: Store<A>) => {
		const retryMeta = state<RetryMeta>(
			{ attempt: 0, pending: false },
			{ name: "retry:meta", equals: () => false },
		);

		const store = producer<A>(
			({ emit, complete, error }) => {
				let attempt = 0;
				let lastDelay: number | undefined;
				let inputTalkback: ((type: number) => void) | null = null;
				let initialized = false;
				let timer: ReturnType<typeof setTimeout> | null = null;
				let stopped = false;

				function updateMeta(patch: Partial<RetryMeta> & { attempt: number }) {
					retryMeta.set({
						attempt: patch.attempt,
						lastError: patch.lastError,
						pending: patch.pending ?? false,
					});
				}

				function connectInput() {
					if (stopped) return;
					if (inputTalkback) {
						inputTalkback(END);
						inputTalkback = null;
					}
					const initial = input.get();
					if (initialized && initial !== undefined) emit(initial as A);
					initialized = true;
					// Guard: teardown may have fired between timer scheduling and now
					if (stopped) return;

					input.source(START, (type: number, data: unknown) => {
						if (stopped) return;
						if (type === START) inputTalkback = data as (type: number) => void;
						if (type === 1) emit(data as A);
						if (type === END) {
							inputTalkback = null;
							if (data !== undefined) {
								// Error — check if we should retry
								const shouldRetry = attempt < maxRetries && (whileFn === null || whileFn(data));

								if (shouldRetry) {
									if (!delayFn) {
										attempt++;
										updateMeta({ attempt, lastError: data });
										connectInput();
									} else {
										const delayMs = delayFn(attempt, data, lastDelay);
										if (delayMs !== null) lastDelay = delayMs;

										if (delayMs === null) {
											// Strategy says stop
											updateMeta({ attempt, lastError: data });
											error(data);
										} else if (delayMs <= 0) {
											// Zero/negative delay — instant retry
											attempt++;
											updateMeta({ attempt, lastError: data });
											connectInput();
										} else {
											// Delayed retry — increment attempt now
											attempt++;
											updateMeta({
												attempt,
												lastError: data,
												pending: true,
											});
											timer = setTimeout(() => {
												timer = null;
												updateMeta({
													attempt,
													lastError: data,
													pending: false,
												});
												connectInput();
											}, delayMs);
										}
									}
								} else {
									updateMeta({ attempt, lastError: data });
									error(data);
								}
							} else {
								complete();
							}
						}
					});
				}

				connectInput();

				return () => {
					stopped = true;
					if (timer !== null) {
						clearTimeout(timer);
						timer = null;
					}
					if (inputTalkback) inputTalkback(END);
				};
			},
			{ initial: input.get() },
		);

		Inspector.register(store, { kind: "withRetry" });

		// Attach retryMeta as observable metadata
		(store as any).retryMeta = retryMeta;

		return store;
	};
}
