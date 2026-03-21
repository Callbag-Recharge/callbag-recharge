// ---------------------------------------------------------------------------
// withBreaker — circuit breaker as pipe operator
// ---------------------------------------------------------------------------
// Blocks values when the breaker is open, trials on half-open, passes when
// closed. Accepts any object implementing the BreakerLike interface (e.g.
// circuitBreaker() from utils). Tier 2 operator built on producer().
//
// Usage:
//   import { circuitBreaker } from 'callbag-recharge/utils';
//   const breaker = circuitBreaker({ failureThreshold: 3 });
//   pipe(source, withBreaker(breaker))
// ---------------------------------------------------------------------------

import { Inspector } from "../core/inspector";
import { producer } from "../core/producer";
import { state } from "../core/state";
import { subscribe } from "../core/subscribe";
import type { Store } from "../core/types";

/** Minimal interface for circuit breaker compatibility. */
export interface BreakerLike {
	canExecute(): boolean;
	recordSuccess(): void;
	recordFailure(error?: unknown): void;
	readonly state: string;
}

export class CircuitOpenError extends Error {
	constructor() {
		super("Circuit breaker is open");
		this.name = "CircuitOpenError";
	}
}

export interface WithBreakerOptions {
	/** Error mode: "skip" silently drops, "error" emits CircuitOpenError. Default: "skip". */
	onOpen?: "skip" | "error";
}

export interface WithBreakerStore<T> extends Store<T> {
	/** Current circuit breaker state (e.g. "closed", "open", "half-open"). */
	breakerState: Store<string>;
}

/**
 * Blocks values when the circuit breaker is open. Passes values when closed, trials on half-open (Tier 2).
 *
 * @param breaker - A circuit breaker instance (e.g. `circuitBreaker()` from utils).
 * @param opts - Optional behavior configuration.
 *
 * @returns Pipe-compatible operator. The returned `WithBreakerStore<A>` has a `breakerState` companion store.
 *
 * @remarks **Tier 2:** Cycle boundary — each forwarded value starts a new DIRTY+value cycle.
 * @remarks **Pluggable:** Accepts any object with `canExecute()`, `recordSuccess()`, `recordFailure()`.
 * @remarks **Success/failure:** Each forwarded value records success. Upstream errors record failure.
 *
 * @example
 * ```ts
 * import { state, pipe } from 'callbag-recharge';
 * import { withBreaker } from 'callbag-recharge/orchestrate';
 * import { circuitBreaker } from 'callbag-recharge/utils';
 *
 * const breaker = circuitBreaker({ failureThreshold: 3 });
 * const input = state(0);
 * const guarded = pipe(input, withBreaker(breaker));
 * ```
 *
 * @seeAlso [withTimeout](./withTimeout) — timeout guard, [withRetry](./withRetry) — retry on failure
 *
 * @category orchestrate
 */
export function withBreaker<A>(
	breaker: BreakerLike,
	opts?: WithBreakerOptions,
): (input: Store<A>) => WithBreakerStore<A> {
	const onOpen = opts?.onOpen ?? "skip";

	return (input: Store<A>): WithBreakerStore<A> => {
		const breakerState = state<string>(breaker.state, {
			name: "breaker:state",
			equals: Object.is,
		});

		const store = producer<A>(
			({ emit, error, complete }) => {
				const sub = subscribe(
					input,
					(v) => {
						if (breaker.canExecute()) {
							breaker.recordSuccess();
							breakerState.set(breaker.state);
							emit(v);
						} else {
							breakerState.set(breaker.state);
							if (onOpen === "error") {
								sub.unsubscribe();
								error(new CircuitOpenError());
							}
							// "skip" mode: silently drop
						}
					},
					{
						onEnd: (err) => {
							if (err !== undefined) {
								breaker.recordFailure(err);
								breakerState.set(breaker.state);
								error(err);
							} else {
								complete();
							}
						},
					},
				);

				return () => {
					sub.unsubscribe();
				};
			},
			{ initial: input.get() },
		);

		const delegate: WithBreakerStore<A> = {
			get: () => store.get() as A,
			source: (type: number, payload?: any) => store.source(type, payload),
			get _status() {
				return (store as any)._status;
			},
			breakerState,
		};

		Inspector.register(delegate, { kind: "withBreaker" });

		return delegate;
	};
}
