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

import { fromTimer } from "../raw/fromTimer";
import type { CallbagSource } from "../raw/subscribe";
import { rawSubscribe } from "../raw/subscribe";

export interface RateLimiter {
	/** Non-blocking check: try to acquire a token. Returns true if allowed. */
	tryAcquire(tokens?: number): boolean;
	/** Acquire tokens: returns a callbag source that emits ms waited then completes. Pass signal to cancel the wait. */
	acquire(signal?: AbortSignal, tokens?: number): CallbagSource;
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

		acquire(signal?: AbortSignal, tokens = 1): CallbagSource {
			return (type: number, sink?: any) => {
				if (type !== 0) return;
				let done = false;
				sink(0, (t: number) => {
					if (t === 2) done = true;
				});

				if (tokens > burst) {
					sink(2, new RangeError(`Cannot acquire ${tokens} tokens (burst capacity is ${burst})`));
					return;
				}
				if (signal?.aborted) {
					sink(2, signal.reason);
					return;
				}

				refill();
				if (_tokens >= tokens) {
					_tokens -= tokens;
					if (!done) sink(1, 0);
					if (!done) sink(2);
					return;
				}

				let totalWait = 0;
				function tryAcquireLoop(): void {
					if (done) return;
					refill();
					if (_tokens >= tokens) {
						_tokens -= tokens;
						const wasDone = done;
						done = true;
						if (!wasDone) {
							sink(1, totalWait);
							sink(2);
						}
						return;
					}
					const deficit = tokens - _tokens;
					const waitMs = (deficit / rate) * 1000;
					totalWait += waitMs;
					rawSubscribe(
						fromTimer(Math.ceil(waitMs), signal),
						() => {
							if (done) return;
							if (signal?.aborted) {
								sink(2, signal.reason);
								return;
							}
							tryAcquireLoop();
						},
						{
							onEnd: (err) => {
								if (err && !done) {
									done = true;
									sink(2, err);
								}
							},
						},
					);
				}
				tryAcquireLoop();
			};
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

		acquire(signal?: AbortSignal, tokens = 1): CallbagSource {
			return (type: number, sink?: any) => {
				if (type !== 0) return;
				let done = false;
				sink(0, (t: number) => {
					if (t === 2) done = true;
				});

				if (tokens > max) {
					sink(2, new RangeError(`Cannot acquire ${tokens} slots (max capacity is ${max})`));
					return;
				}
				if (signal?.aborted) {
					sink(2, signal.reason);
					return;
				}

				prune();
				if (_timestamps.length + tokens <= max) {
					const t = now();
					for (let i = 0; i < tokens; i++) _timestamps.push(t);
					if (!done) sink(1, 0);
					if (!done) sink(2);
					return;
				}

				let totalWait = 0;
				function tryAcquireLoop(): void {
					if (done) return;
					prune();
					if (_timestamps.length + tokens <= max) {
						const t = now();
						for (let i = 0; i < tokens; i++) _timestamps.push(t);
						const wasDone = done;
						done = true;
						if (!wasDone) {
							sink(1, totalWait);
							sink(2);
						}
						return;
					}
					const needed = _timestamps.length + tokens - max;
					const oldestNeeded = _timestamps[needed - 1];
					const waitMs = oldestNeeded !== undefined ? oldestNeeded + windowMs - now() : windowMs;
					if (waitMs <= 0) {
						tryAcquireLoop();
						return;
					}
					totalWait += waitMs;
					rawSubscribe(
						fromTimer(Math.ceil(waitMs), signal),
						() => {
							if (done) return;
							if (signal?.aborted) {
								sink(2, signal.reason);
								return;
							}
							tryAcquireLoop();
						},
						{
							onEnd: (err) => {
								if (err && !done) {
									done = true;
									sink(2, err);
								}
							},
						},
					);
				}
				tryAcquireLoop();
			};
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
