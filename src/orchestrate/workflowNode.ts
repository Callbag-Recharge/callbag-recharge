// ---------------------------------------------------------------------------
// workflowNode — bundled task node with log + circuit breaker + status
// ---------------------------------------------------------------------------
// Combines the common pattern of a workflow node that has:
//   - A reactive log for tracking execution events
//   - A circuit breaker for failure protection
//   - A reactive breaker state store
//   - A simulateWork helper for demo/test scenarios
// ---------------------------------------------------------------------------

import { teardown } from "../core/protocol";
import { state } from "../core/state";
import type { WritableStore } from "../core/types";
import { reactiveLog } from "../data/reactiveLog";
import type { ReactiveLog } from "../data/types";
import { firstValueFrom } from "../extra/firstValueFrom";
import { fromTimer } from "../extra/fromTimer";
import type { BackoffStrategy } from "../utils/backoff";
import { exponential } from "../utils/backoff";
import type { CircuitBreaker, CircuitBreakerOptions, CircuitState } from "../utils/circuitBreaker";
import { circuitBreaker } from "../utils/circuitBreaker";

export interface WorkflowNodeResult {
	/** Node identifier. */
	id: string;
	/** Human-readable label. */
	label: string;
	/** Append-only event log. */
	log: ReactiveLog<string>;
	/** Circuit breaker instance. */
	breaker: CircuitBreaker;
	/** Reactive circuit breaker state ("closed" | "open" | "half-open"). */
	breakerState: WritableStore<CircuitState>;
	/**
	 * Simulate async work with configurable duration and failure rate.
	 * Records success/failure in the circuit breaker and log.
	 * Throws on failure (for task() error propagation).
	 * Respects AbortSignal if provided (for task cancellation).
	 */
	simulate(
		durationRange: [number, number],
		failRate: number,
		signal?: AbortSignal,
	): Promise<string>;
	/** Reset breaker state and reactive store (preserves log history). */
	reset(): void;
	/** Clean up log and stores. */
	destroy(): void;
}

export interface WorkflowNodeOpts {
	/** Max log entries (default: 50). */
	logMaxSize?: number;
	/** Circuit breaker options. */
	breaker?: CircuitBreakerOptions;
	/** Backoff strategy for circuit breaker cooldown (default: exponential 1s base, 2x, 10s max). */
	cooldown?: BackoffStrategy;
}

/**
 * Create a workflow node with log, circuit breaker, and simulation helper.
 *
 * @example
 * ```ts
 * const node = workflowNode("extract", "Extract Data");
 * // Use in a pipeline task — forward signal for cancellation:
 * const extractDef = task(["trigger"], async (signal) => {
 *   node.log.append("[START] Extracting...");
 *   return node.simulate([300, 1000], 0.1, signal);
 * });
 * ```
 */
export function workflowNode(
	id: string,
	label: string,
	opts?: WorkflowNodeOpts,
): WorkflowNodeResult {
	const log = reactiveLog<string>({ id: `${id}:log`, maxSize: opts?.logMaxSize ?? 50 });
	const cooldown = opts?.cooldown ?? exponential({ base: 1000, factor: 2, maxDelay: 10000 });
	const breaker = circuitBreaker({
		failureThreshold: 3,
		cooldownMs: 5000,
		cooldown,
		...opts?.breaker,
	});
	const breakerState = state<CircuitState>("closed", { name: `${id}:breakerState` });

	async function simulate(
		durationRange: [number, number],
		failRate: number,
		signal?: AbortSignal,
	): Promise<string> {
		if (signal?.aborted) {
			log.append("[ABORT] Cancelled before start");
			throw new Error(`${label} aborted`);
		}
		const [min, max] = durationRange;
		const duration = min + Math.random() * (max - min);
		const start = Date.now();
		// §1.16: no raw `new Promise` — use callbag primitives only.
		// The task framework handles cancellation at a higher level (switchMap),
		// so we just check abort after the timer to avoid stale breaker updates.
		await firstValueFrom(fromTimer(duration));
		if (signal?.aborted) {
			const elapsed = Date.now() - start;
			log.append(`[ABORT] Cancelled after ${Math.round(elapsed)}ms`);
			throw new Error(`${label} aborted`);
		}
		if (Math.random() < failRate) {
			breaker.recordFailure();
			breakerState.set(breaker.state);
			const elapsed = Date.now() - start;
			log.append(`[ERROR] Failed after ${Math.round(elapsed)}ms`);
			throw new Error(`${label} failed`);
		}
		breaker.recordSuccess();
		breakerState.set(breaker.state);
		const elapsed = Date.now() - start;
		log.append(`[OK] Completed in ${Math.round(elapsed)}ms`);
		return `${label} result`;
	}

	function reset(): void {
		breaker.reset();
		breakerState.set("closed");
	}

	function destroy(): void {
		log.destroy();
		teardown(breakerState);
	}

	return { id, label, log, breaker, breakerState, simulate, reset, destroy };
}
