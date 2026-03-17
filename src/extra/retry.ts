import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { END, START } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";
import type { BackoffStrategy } from "../utils/backoff";

/**
 * Re-subscribes to the input source on error (END with error).
 *
 * Overloads:
 *   retry(3)                           — instant retry, up to 3 times (backward-compatible)
 *   retry({ count: 5, delay: exp() })  — 5 retries with backoff delay
 *   retry({ delay: exp(), while: fn }) — unlimited retries with condition + backoff
 *
 * Stateful: maintains last value via producer. get() returns input's initial
 * value before first emission, then the latest value from the source.
 *
 * v3: Tier 2 — dynamic subscription operator. Each emit starts a new
 * DIRTY+value cycle. No built-in dedup. Uses raw callbag for END
 * detection (error triggers reconnect, clean completion propagates).
 */
export interface RetryOptions {
	/** Maximum number of retries. Default: Infinity when delay is set. */
	count?: number;
	/** Backoff strategy — returns ms to wait, or null to stop. */
	delay?: BackoffStrategy;
	/** Predicate — retry only if this returns true for the error. */
	while?: (error: unknown) => boolean;
}

export function retry<A>(config: number | RetryOptions): StoreOperator<A, A> {
	const opts: RetryOptions = typeof config === "number" ? { count: config } : config;

	const maxRetries = opts.count ?? (opts.delay ? Infinity : 0);
	const delayFn = opts.delay ?? null;
	const whileFn = opts.while ?? null;

	return (input: Store<A>) => {
		const store = producer<A>(
			({ emit, complete, error }) => {
				let attempt = 0;
				let lastDelay: number | undefined;
				let inputTalkback: ((type: number) => void) | null = null;
				let initialized = false;
				let timer: ReturnType<typeof setTimeout> | null = null;
				let stopped = false;

				function connectInput() {
					if (stopped) return;
					if (inputTalkback) {
						inputTalkback(END);
						inputTalkback = null;
					}
					const initial = input.get();
					// Skip emit on first connect — producer's { initial } already has the value.
					// On retry (reconnect after error), emit to update the output value.
					if (initialized && initial !== undefined) emit(initial as A);
					initialized = true;
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
										// No delay — instant retry (backward-compatible path)
										attempt++;
										connectInput();
									} else {
										const delayMs = delayFn(attempt, data, lastDelay);
										attempt++;
										if (delayMs !== null) lastDelay = delayMs;

										if (delayMs === null || delayMs <= 0) {
											// Strategy says stop or zero delay
											if (delayMs === null) {
												error(data);
											} else {
												connectInput();
											}
										} else {
											// Delayed retry
											timer = setTimeout(() => {
												timer = null;
												connectInput();
											}, delayMs);
										}
									}
								} else {
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

		Inspector.register(store, { kind: "retry" });
		return store;
	};
}
