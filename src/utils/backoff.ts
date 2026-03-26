// ---------------------------------------------------------------------------
// Backoff Strategies — pure delay functions for retry, reconnect, circuit breaker
// ---------------------------------------------------------------------------
// A BackoffStrategy takes an attempt number (0-based) and optional error,
// returns ms to wait before next attempt, or null to stop retrying.
//
// Built-in strategies: constant, linear, exponential, fibonacci, decorrelatedJitter
// All strategies are pure functions — no state, no side effects, no reactive deps.
// ---------------------------------------------------------------------------

/**
 * Returns ms to wait before next attempt, or null to stop retrying.
 * `attempt` is 0-based (0 = first retry, after first failure).
 * `prevDelay` is the delay returned by the previous call (undefined on first call).
 */
export type BackoffStrategy = (
	attempt: number,
	error?: unknown,
	prevDelay?: number,
) => number | null;

export type JitterMode = "none" | "full" | "equal";

// ---------------------------------------------------------------------------
// constant — always the same delay
// ---------------------------------------------------------------------------

export function constant(ms: number): BackoffStrategy {
	return () => ms;
}

// ---------------------------------------------------------------------------
// linear — base + step * attempt
// ---------------------------------------------------------------------------

export function linear(base: number, step = base): BackoffStrategy {
	return (attempt) => base + step * attempt;
}

// ---------------------------------------------------------------------------
// exponential — base * factor^attempt, capped at maxDelay, with jitter
// ---------------------------------------------------------------------------

export interface ExponentialOptions {
	/** Base delay in ms. Default: 100 */
	base?: number;
	/** Multiplication factor per attempt. Default: 2 */
	factor?: number;
	/** Maximum delay in ms. Default: 30_000 */
	maxDelay?: number;
	/** Jitter mode. Default: "none" */
	jitter?: JitterMode;
}

export function exponential(opts?: ExponentialOptions): BackoffStrategy {
	const base = opts?.base ?? 100;
	const factor = opts?.factor ?? 2;
	const maxDelay = opts?.maxDelay ?? 30_000;
	const jitter = opts?.jitter ?? "none";

	return (attempt) => {
		const raw = Math.min(base * factor ** attempt, maxDelay);
		return applyJitter(raw, jitter);
	};
}

// ---------------------------------------------------------------------------
// fibonacci — fib(attempt) * base, gentler than exponential
// ---------------------------------------------------------------------------

export function fibonacci(base = 100, maxDelay = 30_000): BackoffStrategy {
	return (attempt) => {
		let a = 1;
		let b = 1;
		for (let i = 0; i < attempt; i++) {
			const next = a + b;
			a = b;
			b = next;
		}
		return Math.min(a * base, maxDelay);
	};
}

// ---------------------------------------------------------------------------
// decorrelatedJitter — AWS-recommended: random(base, min(max, lastDelay * 3))
// ---------------------------------------------------------------------------
// Stateless — uses `prevDelay` (passed by the consumer) instead of closure state.
// Safe to share across concurrent retry sequences.
// ---------------------------------------------------------------------------

export function decorrelatedJitter(base = 100, max = 30_000): BackoffStrategy {
	return (_attempt, _error, prevDelay) => {
		const last = prevDelay ?? base;
		const ceiling = Math.min(max, last * 3);
		return randomBetween(base, ceiling);
	};
}

// ---------------------------------------------------------------------------
// withMaxAttempts — decorator that caps any strategy at N attempts
// ---------------------------------------------------------------------------

export function withMaxAttempts(strategy: BackoffStrategy, maxAttempts: number): BackoffStrategy {
	return (attempt, error, prevDelay) => {
		if (attempt >= maxAttempts) return null;
		return strategy(attempt, error, prevDelay);
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyJitter(delay: number, mode: JitterMode): number {
	switch (mode) {
		case "none":
			return delay;
		case "full":
			return randomBetween(0, delay);
		case "equal":
			return delay / 2 + randomBetween(0, delay / 2);
	}
}

function randomBetween(min: number, max: number): number {
	return min + Math.random() * (max - min);
}

// ---------------------------------------------------------------------------
// resolveBackoffPreset — resolve a named preset to a BackoffStrategy
// ---------------------------------------------------------------------------

/** Named backoff preset. Resolved to a BackoffStrategy by `resolveBackoffPreset`. */
export type BackoffPreset =
	| "constant"
	| "linear"
	| "exponential"
	| "fibonacci"
	| "decorrelatedJitter";

/** Resolve a named backoff preset to a BackoffStrategy with default options. */
export function resolveBackoffPreset(name: BackoffPreset): BackoffStrategy {
	switch (name) {
		case "constant":
			return constant(1000);
		case "linear":
			return linear(1000);
		case "exponential":
			return exponential();
		case "fibonacci":
			return fibonacci();
		case "decorrelatedJitter":
			return decorrelatedJitter();
		default:
			throw new Error(
				`Unknown backoff preset: "${name}". Use one of: constant, linear, exponential, fibonacci, decorrelatedJitter`,
			);
	}
}
