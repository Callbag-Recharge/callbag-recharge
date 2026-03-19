// ---------------------------------------------------------------------------
// rateLimiter — reactive rate-limiting operator
// ---------------------------------------------------------------------------
// Wraps a source store with a configurable rate-limiting strategy:
// - "drop": silently skip emissions over limit
// - "queue": buffer and replay when window resets (bounded by maxQueueSize)
// - "error": forward an error when limit exceeded
//
// Built on: state, subscribe
// ---------------------------------------------------------------------------

import { producer } from "../../core/producer";
import { state } from "../../core/state";
import type { Store } from "../../core/types";
import { subscribe } from "../../extra/subscribe";

export type RateLimitStrategy = "drop" | "queue" | "error";

export interface RateLimiterOptions {
	/** Max emissions allowed per window. */
	maxPerWindow: number;
	/** Window duration in ms. */
	windowMs: number;
	/** Strategy when rate exceeded. Default: "drop" */
	strategy?: RateLimitStrategy;
	/** Max queue size for "queue" strategy. Default: 1000. Excess items dropped. */
	maxQueueSize?: number;
	/** Debug name. */
	name?: string;
}

export interface RateLimiterResult<T> {
	/** Rate-limited output store. */
	store: Store<T | undefined>;
	/** Number of items dropped/queued in current window. */
	dropped: Store<number>;
	/** Whether the rate limit is currently active (at capacity). */
	limited: Store<boolean>;
	/** Latest error (only for "error" strategy). */
	error: Store<unknown | undefined>;
	/** Reset the rate limiter state. */
	reset: () => void;
	/** Dispose the rate limiter (cleanup interval + subscription). */
	dispose: () => void;
}

/**
 * Creates a reactive rate-limiting wrapper around a source store.
 *
 * @param source - The source store to rate-limit.
 * @param opts - Rate limiter configuration.
 *
 * @returns `RateLimiterResult<T>` — `store`, `dropped`, `limited`, `error`, `reset`, `dispose`.
 *
 * @remarks **Drop strategy:** Emissions over the limit are silently discarded.
 * @remarks **Queue strategy:** Emissions over the limit are buffered (up to `maxQueueSize`) and replayed when the window resets.
 * @remarks **Error strategy:** The output store errors when the limit is exceeded.
 * @remarks **hasNext (pagination note):** When the last page returns exactly `pageSize` items, `hasNext` will be true. The next fetch may return 0 items. This is standard offset-based pagination behavior without a total count.
 *
 * @category patterns
 */
export function rateLimiter<T>(source: Store<T>, opts: RateLimiterOptions): RateLimiterResult<T> {
	const strategy = opts.strategy ?? "drop";
	const maxQueueSize = opts.maxQueueSize ?? 1000;

	const output = producer<T>(undefined, {
		name: opts.name ? `${opts.name}.store` : "rateLimiter.store",
		resubscribable: true,
	});
	const droppedStore = state<number>(0, {
		name: opts.name ? `${opts.name}.dropped` : "rateLimiter.dropped",
	});
	const limitedStore = state<boolean>(false, {
		name: opts.name ? `${opts.name}.limited` : "rateLimiter.limited",
	});
	const errorStore = state<unknown | undefined>(undefined, {
		name: opts.name ? `${opts.name}.error` : "rateLimiter.error",
	});

	let count = 0;
	const queue: T[] = [];
	let errored = false;
	let disposed = false;

	function resetWindow(): void {
		if (disposed) return;
		count = 0;
		limitedStore.set(false);

		// Flush queue for queue strategy
		if (strategy === "queue") {
			while (queue.length > 0 && count < opts.maxPerWindow) {
				const item = queue.shift()!;
				count++;
				output.emit(item);
			}
			// Update dropped to reflect remaining queued items
			droppedStore.set(queue.length);
			if (count >= opts.maxPerWindow) {
				limitedStore.set(true);
			}
		} else {
			droppedStore.set(0);
		}
	}

	const intervalId = setInterval(resetWindow, opts.windowMs);

	const unsub = subscribe(
		source,
		(value) => {
			if (errored || disposed) return;

			if (count < opts.maxPerWindow) {
				count++;
				output.emit(value);
				if (count >= opts.maxPerWindow) {
					limitedStore.set(true);
				}
			} else {
				// Rate limit exceeded
				switch (strategy) {
					case "drop":
						droppedStore.update((n) => n + 1);
						break;
					case "queue":
						if (queue.length < maxQueueSize) {
							queue.push(value);
						}
						droppedStore.update((n) => n + 1);
						break;
					case "error":
						errored = true;
						droppedStore.update((n) => n + 1);
						errorStore.set(new Error("Rate limit exceeded"));
						output.error(new Error("Rate limit exceeded"));
						break;
				}
			}
		},
		{
			onEnd: () => {
				// Auto-dispose when source completes or errors
				dispose();
			},
		},
	);

	function reset(): void {
		count = 0;
		queue.length = 0;
		errored = false;
		droppedStore.set(0);
		limitedStore.set(false);
		errorStore.set(undefined);
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		clearInterval(intervalId);
		queue.length = 0;
		unsub();
	}

	return {
		store: output as Store<T | undefined>,
		dropped: droppedStore,
		limited: limitedStore,
		error: errorStore,
		reset,
		dispose,
	};
}
