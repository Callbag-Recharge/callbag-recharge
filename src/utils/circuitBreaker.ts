// ---------------------------------------------------------------------------
// Circuit Breaker — three-state failure isolation pattern
// ---------------------------------------------------------------------------
// Pure state machine: CLOSED → OPEN → HALF_OPEN → CLOSED/OPEN
// No reactive dependencies. Uses BackoffStrategy for cooldown timing.
//
// - CLOSED: requests flow through. Failures counted. Threshold → OPEN.
// - OPEN: requests rejected. After cooldown → HALF_OPEN.
// - HALF_OPEN: limited trial requests. Success → CLOSED. Failure → OPEN.
// ---------------------------------------------------------------------------

import type { BackoffStrategy } from "./backoff";

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
	/** Number of consecutive failures before opening. Default: 5 */
	failureThreshold?: number;
	/** Base cooldown in ms before transitioning to half-open. Default: 30_000 */
	cooldownMs?: number;
	/** Backoff strategy for cooldown escalation across consecutive open cycles. */
	cooldown?: BackoffStrategy;
	/** Max trial requests allowed in half-open state. Default: 1 */
	halfOpenMax?: number;
	/** Optional clock function for testing. Default: Date.now */
	now?: () => number;
}

export interface CircuitBreaker {
	/** Whether a request should be allowed through. */
	canExecute(): boolean;
	/** Record a successful execution. */
	recordSuccess(): void;
	/** Record a failed execution. */
	recordFailure(error?: unknown): void;
	/** Current circuit state. */
	readonly state: CircuitState;
	/** Number of consecutive failures in current closed period. */
	readonly failureCount: number;
	/** Manually reset to closed state. */
	reset(): void;
}

export function circuitBreaker(opts?: CircuitBreakerOptions): CircuitBreaker {
	const threshold = opts?.failureThreshold ?? 5;
	const baseCooldown = opts?.cooldownMs ?? 30_000;
	const cooldownStrategy = opts?.cooldown ?? null;
	const halfOpenMax = opts?.halfOpenMax ?? 1;
	const now = opts?.now ?? Date.now;

	let _state: CircuitState = "closed";
	let _failureCount = 0;
	let _openCycle = 0; // tracks consecutive open→half-open→open cycles for backoff
	let _lastOpenedAt = 0;
	let _lastCooldownMs = baseCooldown;
	let _halfOpenAttempts = 0;

	function getCooldownMs(): number {
		if (!cooldownStrategy) return baseCooldown;
		const delay = cooldownStrategy(_openCycle);
		return delay !== null ? delay : baseCooldown;
	}

	function transitionToOpen(): void {
		_state = "open";
		_lastCooldownMs = getCooldownMs();
		_lastOpenedAt = now();
		_halfOpenAttempts = 0;
	}

	const breaker: CircuitBreaker = {
		canExecute(): boolean {
			if (_state === "closed") return true;

			if (_state === "open") {
				const elapsed = now() - _lastOpenedAt;
				if (elapsed >= _lastCooldownMs) {
					_state = "half-open";
					_halfOpenAttempts = 1; // first trial consumed by this call
					return true;
				}
				return false;
			}

			// half-open: allow limited trial requests
			if (_halfOpenAttempts < halfOpenMax) {
				_halfOpenAttempts++;
				return true;
			}
			return false;
		},

		recordSuccess(): void {
			if (_state === "half-open") {
				_state = "closed";
				_failureCount = 0;
				_openCycle = 0;
			} else if (_state === "closed") {
				_failureCount = 0;
			}
		},

		recordFailure(_error?: unknown): void {
			if (_state === "half-open") {
				_openCycle++;
				transitionToOpen();
				return;
			}

			if (_state === "closed") {
				_failureCount++;
				if (_failureCount >= threshold) {
					transitionToOpen();
				}
			}
		},

		get state(): CircuitState {
			// Read-only — does not trigger transitions. Use canExecute() to
			// trigger the open→half-open transition. This avoids inconsistency
			// between the getter and canExecute on _halfOpenAttempts.
			return _state;
		},

		get failureCount(): number {
			return _failureCount;
		},

		reset(): void {
			_state = "closed";
			_failureCount = 0;
			_openCycle = 0;
			_halfOpenAttempts = 0;
		},
	};

	return breaker;
}
