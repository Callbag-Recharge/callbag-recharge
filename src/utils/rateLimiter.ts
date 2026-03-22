// ---------------------------------------------------------------------------
// Rate Limiter — token bucket + sliding window
// ---------------------------------------------------------------------------
// Different from throttle/debounce (per-stream). These are shared,
// cross-stream rate limiters for API calls, write operations, etc.
//
// Token bucket: refills at `rate` tokens/second, max `burst` tokens.
// Sliding window: timestamps of recent calls, reject if window full.
//
// Pure utilities — no reactive dependencies.
// ---------------------------------------------------------------------------

import { firstValueFrom } from "../raw/firstValueFrom";
import { fromTimer } from "../raw/fromTimer";

export interface RateLimiter {
	/** Non-blocking check: try to acquire a token. Returns true if allowed. */
	tryAcquire(tokens?: number): boolean;
	/** Blocking acquire: waits if needed, returns ms waited. Pass signal to cancel the wait. */
	acquire(tokens?: number, signal?: AbortSignal): Promise<number>;
	/** Current available tokens/capacity. */
	available(): number;
	/** Reset to full capacity. */
	reset(): void;
}

// ---------------------------------------------------------------------------
// Token Bucket — steady-rate limiting with burst allowance
// ---------------------------------------------------------------------------

export interface TokenBucketOptions {
	/** Tokens added per second. */
	rate: number;
	/** Maximum tokens (burst capacity). Default: rate */
	burst?: number;
	/** Optional clock function for testing. Default: Date.now */
	now?: () => number;
}

export function tokenBucket(opts: TokenBucketOptions): RateLimiter {
	const rate = opts.rate;
	const burst = opts.burst ?? rate;
	const now = opts.now ?? Date.now;

	let _tokens = burst;
	let _lastRefill = now();

	function refill(): void {
		const current = now();
		const elapsed = (current - _lastRefill) / 1000;
		_tokens = Math.min(burst, _tokens + elapsed * rate);
		_lastRefill = current;
	}

	return {
		tryAcquire(tokens = 1): boolean {
			refill();
			if (_tokens >= tokens) {
				_tokens -= tokens;
				return true;
			}
			return false;
		},

		async acquire(tokens = 1, signal?: AbortSignal): Promise<number> {
			if (tokens > burst)
				throw new RangeError(`Cannot acquire ${tokens} tokens (burst capacity is ${burst})`);
			signal?.throwIfAborted();
			refill();
			if (_tokens >= tokens) {
				_tokens -= tokens;
				return 0;
			}
			let totalWait = 0;
			// Loop: concurrent tryAcquire() calls may consume tokens during our sleep
			while (_tokens < tokens) {
				const deficit = tokens - _tokens;
				const waitMs = (deficit / rate) * 1000;
				totalWait += waitMs;
				await sleep(waitMs, signal);
				refill();
			}
			_tokens -= tokens;
			return totalWait;
		},

		available(): number {
			refill();
			return Math.floor(_tokens);
		},

		reset(): void {
			_tokens = burst;
			_lastRefill = now();
		},
	};
}

// ---------------------------------------------------------------------------
// Sliding Window — count-based limiting over a time window
// ---------------------------------------------------------------------------

export interface SlidingWindowOptions {
	/** Maximum requests allowed in the window. */
	max: number;
	/** Window duration in ms. */
	windowMs: number;
	/** Optional clock function for testing. Default: Date.now */
	now?: () => number;
}

export function slidingWindow(opts: SlidingWindowOptions): RateLimiter {
	const max = opts.max;
	const windowMs = opts.windowMs;
	const now = opts.now ?? Date.now;

	const _timestamps: number[] = [];

	function prune(): void {
		const cutoff = now() - windowMs;
		while (_timestamps.length > 0 && _timestamps[0] <= cutoff) {
			_timestamps.shift();
		}
	}

	return {
		tryAcquire(tokens = 1): boolean {
			prune();
			if (_timestamps.length + tokens <= max) {
				const t = now();
				for (let i = 0; i < tokens; i++) _timestamps.push(t);
				return true;
			}
			return false;
		},

		async acquire(tokens = 1, signal?: AbortSignal): Promise<number> {
			if (tokens > max)
				throw new RangeError(`Cannot acquire ${tokens} slots (max capacity is ${max})`);
			signal?.throwIfAborted();
			prune();
			if (_timestamps.length + tokens <= max) {
				const t = now();
				for (let i = 0; i < tokens; i++) _timestamps.push(t);
				return 0;
			}
			let totalWait = 0;
			// Loop: concurrent tryAcquire() calls may fill slots during our sleep
			while (_timestamps.length + tokens > max) {
				const needed = _timestamps.length + tokens - max;
				const oldestNeeded = _timestamps[needed - 1];
				const waitMs = oldestNeeded !== undefined ? oldestNeeded + windowMs - now() : windowMs;
				if (waitMs > 0) {
					totalWait += waitMs;
					await sleep(waitMs, signal);
				}
				prune();
			}
			const t = now();
			for (let i = 0; i < tokens; i++) _timestamps.push(t);
			return totalWait;
		},

		available(): number {
			prune();
			return max - _timestamps.length;
		},

		reset(): void {
			_timestamps.length = 0;
		},
	};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) {
		return Promise.reject(signal.reason);
	}
	return firstValueFrom(fromTimer(Math.ceil(ms), signal)).then(() => {
		// fromTimer emits on abort instead of rejecting — restore abort semantics
		if (signal?.aborted) throw signal.reason;
	});
}
