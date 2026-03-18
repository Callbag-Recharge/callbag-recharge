import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { END, START } from "../core/protocol";
import type { Store, StoreOperator } from "../core/types";
import type { BackoffStrategy } from "../utils/backoff";

export interface RetryOptions {
	/** Maximum number of retries. Default: Infinity when delay is set. */
	count?: number;
	/** Backoff strategy — returns ms to wait, or null to stop. */
	delay?: BackoffStrategy;
	/** Predicate — retry only if this returns true for the error. */
	while?: (error: unknown) => boolean;
}

/**
 * Re-subscribes to the input store after errors, with optional count limit and backoff.
 *
 * @param config - Shorthand `number` (max retries) or `{ count, delay, while }`.
 *
 * @returns `StoreOperator<A, A>` — Tier 2; clean completion ends retries.
 *
 * @optionsType RetryOptions
 * @option count | number | varies | Max retries; with `delay`, default is unbounded unless set.
 * @option delay | BackoffStrategy | undefined | Milliseconds between attempts; `null` from strategy stops.
 * @option while | (err) => boolean | undefined | Retry only when predicate holds.
 *
 * @seeAlso [rescue](/api/rescue), [repeat](/api/repeat)
 *
 * @category extra
 */
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
